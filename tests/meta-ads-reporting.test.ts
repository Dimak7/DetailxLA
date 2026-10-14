import test from "node:test";
import assert from "node:assert/strict";
import { aggregateMetaRows, fetchMetaAdsReport, metaScopeKey, saveMetaAdsConfig, syncMetaAdsReport, metaAdsReportStatus, type MetaAdsConfig } from "../lib/integrations/meta-ads-reporting";
import { closeDatabase, query } from "../lib/platform/db";
process.env.PGLITE_PATH="memory://meta-ads-reporting";
Object.assign(process.env,{NODE_ENV:"test",SETTINGS_ENCRYPTION_KEY:"test-meta-reporting-encryption-key-long-enough",ADMIN_EMAIL:"meta-report-owner@example.test",ADMIN_PASSWORD:"test-only-meta-reporting-owner-password"});
for(const key of ["DATABASE_URL","RAILWAY_ENVIRONMENT","META_ADS_REPORTING_TOKEN"])delete process.env[key];
const config:MetaAdsConfig={account_id:"123456789",campaign_ids:["111111"],whole_account:false,conversion_action:"lead"};
const row=(id="111111")=>({campaign_id:id,campaign_name:"West Loop campaign",account_currency:"USD",spend:"12.34",impressions:"1000",clicks:"20",inline_link_clicks:"12",actions:[{action_type:"lead",value:"3"},{action_type:"offsite_conversion.fb_pixel_lead",value:"2"}],action_values:[{action_type:"lead",value:"150"}]});
test("Meta totals use one conversion action and enforce selected campaigns and currency",()=>{
 const result=aggregateMetaRows([row()],config,{currency:"USD",timezone:"America/Chicago",name:"WL"});
 assert.equal(result.spend_cents,1234);assert.equal(result.clicks,20);assert.equal(result.link_clicks,12);assert.equal(result.conversions,3);assert.equal(result.conversion_value_cents,15000);
 assert.throws(()=>aggregateMetaRows([row("222222")],config,{currency:"USD",timezone:"UTC",name:"WL"}),/outside/);
 assert.throws(()=>aggregateMetaRows([row()],config,{currency:"EUR",timezone:"UTC",name:"WL"}),/USD/);
 assert.throws(()=>aggregateMetaRows([{...row(),spend:"invalid"}],config,{currency:"USD",timezone:"UTC",name:"WL"}),/invalid/);
 assert.notEqual(metaScopeKey(config),metaScopeKey({...config,conversion_action:"purchase"}));
});
test("Meta reporting paginates on the official host using bearer auth, never provider next URLs",async(t)=>{
 const requests:URL[]=[];
 t.mock.method(globalThis,"fetch",async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(String(input));requests.push(url);assert.equal(url.origin,"https://graph.facebook.com");assert.equal(init?.method,undefined);assert.equal((init?.headers as Record<string,string>).Authorization,"Bearer test-only-token");assert.equal(url.searchParams.has("access_token"),false);
  if(!url.pathname.endsWith("/insights"))return Response.json({id:"act_123456789",name:"WL",currency:"USD",timezone_name:"America/Chicago"});
  assert.deepEqual(JSON.parse(url.searchParams.get("filtering")!),[{field:"campaign.id",operator:"IN",value:["111111"]}]);
  assert.equal(url.searchParams.get("action_report_time"),"conversion");
  return Response.json(url.searchParams.has("after")?{data:[{...row(),spend:"1.00"}]}:{data:[row()],paging:{next:"https://untrusted.invalid/?access_token=do-not-follow",cursors:{after:"page-2"}}});
 });
 const result=await fetchMetaAdsReport(config,"2026-10-01","2026-10-02","test-only-token");
 assert.equal(requests.length,3);assert.equal(result.spend_cents,1334);assert.equal(result.conversions,6);assert.equal(result.campaigns.length,1);
});
test("failed Meta refresh retains verified data; reconnecting a different scope never shows the old account",async(t)=>{
 let fail=false,calls=0;
 t.mock.method(globalThis,"fetch",async(input:RequestInfo|URL)=>{
  calls++;const url=new URL(String(input));
  if(fail)return Response.json({error:{message:"private token must not leak"}},{status:401});
  return Response.json(url.pathname.endsWith("/insights")?{data:[row()]}:{id:"act_123456789",name:"WL",currency:"USD",timezone_name:"America/Chicago"});
 });
 try{
  const actor=(await query<{id:string}>("SELECT id FROM wl.users WHERE email=$1",[process.env.ADMIN_EMAIL]))[0];
  await saveMetaAdsConfig(config,"test-only-token",actor.id);
  const secret=(await query<{ciphertext:string}>("SELECT ciphertext FROM wl.secrets WHERE key='meta_ads_reporting_token'"))[0];assert.equal(secret.ciphertext.includes("test-only-token"),false);
  await syncMetaAdsReport("2026-10-01","2026-10-02");
  assert.equal((await metaAdsReportStatus("2026-10-01","2026-10-02")).report?.payload?.spend_cents,1234);
  await syncMetaAdsReport("2026-10-01","2026-10-02");assert.equal(calls,2);
  await query("UPDATE wl.meta_ads_reports SET attempted_at=now()-interval '2 minutes'");fail=true;
  await assert.rejects(syncMetaAdsReport("2026-10-01","2026-10-02"),/HTTP 401/);
  const stale=await metaAdsReportStatus("2026-10-01","2026-10-02");assert.equal(stale.report?.payload?.spend_cents,1234);assert.ok(stale.report?.error);assert.equal(JSON.stringify(stale).includes("test-only-token"),false);assert.equal(JSON.stringify(stale).includes("private token"),false);
  await saveMetaAdsConfig({...config,campaign_ids:["222222"]},"",actor.id);
  assert.equal((await metaAdsReportStatus("2026-10-01","2026-10-02")).report,null);
 }finally{await closeDatabase();}
});
