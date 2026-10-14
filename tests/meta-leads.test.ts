import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {verifyMetaSignature,metaLeadContact,receiveMetaLeads,importMetaLead,saveMetaLeadsConfig} from "../lib/integrations/meta-leads";
import {query,closeDatabase} from "../lib/platform/db";
process.env.PGLITE_PATH="memory://meta-leads";
Object.assign(process.env,{NODE_ENV:"test",ADMIN_EMAIL:"meta-owner@example.test",ADMIN_PASSWORD:"test-meta-owner-password",SETTINGS_ENCRYPTION_KEY:"test-only-encryption-key-not-production-1234567"});
for(const key of ["DATABASE_URL","RAILWAY_ENVIRONMENT","TELEGRAM_BOT_TOKEN","META_LEADS_PAGE_TOKEN","META_LEADS_APP_SECRET","META_LEADS_VERIFY_TOKEN"])delete process.env[key];
test("signed webhook rejects altered bytes and missing signatures",()=>{
 const body='{"object":"page"}',key="test-app-secret",signature="sha256="+createHmac("sha256",key).update(body).digest("hex");
 assert.equal(verifyMetaSignature(body,signature,key),true);
 assert.equal(verifyMetaSignature(body+" ",signature,key),false);
 assert.equal(verifyMetaSignature(body,"",key),false);
 assert.equal(verifyMetaSignature(body,signature,""),false);
});
test("Meta forms retain custom questions and tolerate missing email",()=>{
 const lead=metaLeadContact({id:"123456",form_id:"234567",field_data:[{name:"first_name",values:["Sam"]},{name:"last_name",values:["Test"]},{name:"phone_number",values:["3125550123"]},{name:"which_services",values:["Interior","Ceramic"]}]});
 assert.equal(lead.name,"Sam Test");assert.equal(lead.email,"");assert.match(lead.notes,/Interior, Ceramic/);
});
test("allowed forms import once, keep attribution and all answers, and queue one call notification",async()=>{
 try {
  await saveMetaLeadsConfig({page_id:"111111",form_ids:["222222"]},"test-page-token","test-app-secret");
  await query("UPDATE wl.settings SET value=value || '{\"telegram_chat_id\":\"-100-test\"}'::jsonb WHERE key='business'");
  const event={leadgen_id:"333333",page_id:"111111",form_id:"222222",ad_id:"444444"};
  const payload=(value:unknown,page="111111")=>({object:"page",entry:[{id:page,changes:[{field:"leadgen",value}]}]});
  assert.equal(await receiveMetaLeads(payload({...event,form_id:"999999"})),0);
  assert.equal(await receiveMetaLeads(payload(event,"999999")),0);
  assert.equal(await receiveMetaLeads(payload(event)),1);assert.equal(await receiveMetaLeads(payload(event)),0);
  const detail={id:"333333",form_id:"222222",campaign_id:"555555",ad_id:"444444",custom_disclaimer_responses:[{checkbox_key:"privacy",is_checked:true}],field_data:[{name:"full_name",values:["Quote Test"]},{name:"phone_number",values:["3125550123"]},{name:"service",values:["Ceramic coating"]}]};
  await assert.rejects(importMetaLead(event,{...detail,form_id:"999999"}),/does not match/);
  assert.equal(await importMetaLead(event,detail),true);assert.equal(await importMetaLead(event,detail),false);
  const rows=await query<{name:string;call_customer:boolean;meta_payload:unknown;source:string;lead_stream:string;campaign:string}>("SELECT l.*,a.source,a.lead_stream,a.campaign FROM wl.leads l JOIN wl.attributions a ON a.id=l.attribution_id WHERE l.origin='meta'");
  assert.equal(rows.length,1);assert.equal(rows[0].call_customer,true);assert.equal(rows[0].campaign,"555555");assert.equal(rows[0].source,"Meta Ads");assert.equal(rows[0].lead_stream,"Business Meta · 10%");assert.deepEqual(rows[0].meta_payload,detail);
  assert.equal((await query("SELECT id FROM wl.messages WHERE dedupe_key='meta-lead:333333:telegram'")).length,1);
  assert.equal((await query("SELECT id FROM wl.events WHERE id='meta-lead:333333'")).length,1);
 }finally{await closeDatabase();}
});
