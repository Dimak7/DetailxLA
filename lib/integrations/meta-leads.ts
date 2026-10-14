import {createHmac,timingSafeEqual,randomUUID,randomBytes} from "node:crypto";
import {z} from "zod";
import {query,transaction} from "../platform/db";
import {AppError} from "../platform/auth";
import {secret,saveSecret,settings,siteUrl} from "../platform/settings";
import {saveAttribution} from "../platform/attribution";
import {enqueue} from "../platform/outbox";
export const metaLeadsConfigSchema=z.object({page_id:z.string().regex(/^\d{5,30}$/),form_ids:z.array(z.string().regex(/^\d{5,30}$/)).min(1).max(100)});
export type MetaLeadsConfig=z.infer<typeof metaLeadsConfigSchema>;
export async function metaLeadsConfig(){const row=(await query<{value:unknown}>("SELECT value FROM wl.settings WHERE key='meta_leads'"))[0];return row?metaLeadsConfigSchema.parse(row.value):null;}
export function verifyMetaSignature(body:string,signature:string,appSecret:string){
 if(!appSecret||!/^sha256=[a-f0-9]{64}$/.test(signature))return false;
 return timingSafeEqual(Buffer.from(signature.slice(7),"hex"),createHmac("sha256",appSecret).update(body).digest());
}
const payloadSchema=z.object({object:z.literal("page"),entry:z.array(z.object({id:z.string(),changes:z.array(z.object({field:z.string(),value:z.unknown()})).default([])})).max(100)});
const eventSchema=z.object({leadgen_id:z.string().regex(/^\d{5,30}$/),page_id:z.string().regex(/^\d{5,30}$/),form_id:z.string().regex(/^\d{5,30}$/),ad_id:z.string().regex(/^\d{5,30}$/).optional()});
export async function receiveMetaLeads(payload:unknown){
 const config=await metaLeadsConfig();if(!config)throw new AppError("Meta lead forms are not configured.",503);
 const data=payloadSchema.parse(payload);let queued=0;
 await transaction(async q=>{for(const entry of data.entry){if(entry.id!==config.page_id)continue;for(const change of entry.changes){
  if(change.field!=="leadgen")continue;const result=eventSchema.safeParse(change.value);if(!result.success)continue;const e=result.data;
  if(e.page_id!==config.page_id||!config.form_ids.includes(e.form_id))continue;
  const inserted=await q("INSERT INTO wl.meta_lead_events(leadgen_id,page_id,form_id,ad_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING leadgen_id",[e.leadgen_id,e.page_id,e.form_id,e.ad_id||""]);queued+=inserted.rows.length;
 }}});return queued;
}
const leadSchema=z.object({id:z.string(),form_id:z.string(),ad_id:z.string().optional(),campaign_id:z.string().optional(),created_time:z.string().optional(),field_data:z.array(z.object({name:z.string().max(500),values:z.array(z.string().max(12000)).max(100)})).max(200)}).passthrough();
export function metaLeadContact(input:unknown){
 const data=leadSchema.parse(input),fields=Object.fromEntries(data.field_data.map(f=>[f.name,f.values.join(", ")]));
 const name=fields.full_name||[fields.first_name,fields.last_name].filter(Boolean).join(" ")||"Facebook quote enquiry";
 return {data,name:name.slice(0,160),email:(fields.email||"").slice(0,320).toLowerCase(),phone:(fields.phone_number||fields.phone||"").slice(0,60),notes:data.field_data.map(f=>`${f.name.replaceAll("_"," ")}: ${f.values.join(", ")}`).join("\n")};
}
async function graphLead(id:string){
 const token=await secret("meta_leads_page_token");if(!token)throw new AppError("Connect a Page token with lead retrieval access.");
 const version=process.env.META_ADS_API_VERSION||"v26.0";
 const url=new URL(`https://graph.facebook.com/${version}/${id}`);url.searchParams.set("fields","id,created_time,form_id,ad_id,campaign_id,field_data,custom_disclaimer_responses");
 const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000),cache:"no-store"});
 if(!response.ok)throw new AppError(response.status===401||response.status===403?"Meta denied lead access. Check the Page token and lead permissions.":"Meta could not return the lead. Check form access and retry.",502);
 return response.json();
}
export async function importMetaLead(event:{leadgen_id:string;page_id:string;form_id:string},input:unknown){
 const contact=metaLeadContact(input);if(contact.data.id!==event.leadgen_id||contact.data.form_id!==event.form_id)throw new AppError("Meta lead does not match the subscribed form.");
 const business=await settings();return transaction(async q=>{
  const locked=(await q<{lead_id:string|null}>("SELECT lead_id FROM wl.meta_lead_events WHERE leadgen_id=$1 FOR UPDATE",[event.leadgen_id])).rows[0];
  if(!locked||locked.lead_id)return false;
  const config=(await q<{value:MetaLeadsConfig}>("SELECT value FROM wl.settings WHERE key='meta_leads'" )).rows[0]?.value;
  if(!config||config.page_id!==event.page_id||!config.form_ids.includes(event.form_id))throw new AppError("This form is no longer connected.");
  const id=randomUUID(),session=randomUUID(),attribution=await saveAttribution(q,session,{source:"meta",medium:"paid_social",lead_stream:"business-meta",campaign:contact.data.campaign_id||"",content:contact.data.ad_id||""});
  await q("INSERT INTO wl.leads(id,name,email,phone,notes,attribution_id,origin,call_customer,meta_payload) VALUES($1,$2,$3,$4,$5,$6,'meta',true,$7::jsonb)",[id,contact.name,contact.email,contact.phone,contact.notes,attribution,JSON.stringify(input)]);
  await q("INSERT INTO wl.events(id,name,session_id,attribution_id) VALUES($1,'lead_created',$2,$3)",["meta-lead:"+event.leadgen_id,session,attribution]);
  await q("INSERT INTO wl.timeline(id,lead_id,type,body) VALUES($1,$2,'lead_created','Facebook quote form received · Call Customer')",[randomUUID(),id]);
  if(business.telegram_chat_id)await enqueue(q,{key:"meta-lead:"+event.leadgen_id+":telegram",channel:"telegram",recipient:business.telegram_chat_id,subject:"Call Customer · New Facebook quote",body:[contact.name,contact.phone||"Phone not provided",contact.email,contact.notes.slice(0,2800),`${siteUrl()}/admin/leads?search=${encodeURIComponent(contact.email||contact.name)}`].filter(Boolean).join("\n")});
  await q("UPDATE wl.meta_lead_events SET lead_id=$2,imported_at=now(),locked_at=NULL,error='' WHERE leadgen_id=$1",[event.leadgen_id,id]);return true;
 });
}
export async function processMetaLeads(limit=10){let imported=0;for(let i=0;i<limit;i++){
 const event=await transaction(async q=>{const row=(await q<{leadgen_id:string;page_id:string;form_id:string}>("SELECT leadgen_id,page_id,form_id FROM wl.meta_lead_events WHERE imported_at IS NULL AND next_attempt_at<=now() AND (locked_at IS NULL OR locked_at<now()-interval '5 minutes') ORDER BY received_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];if(row)await q("UPDATE wl.meta_lead_events SET locked_at=now(),attempts=attempts+1 WHERE leadgen_id=$1",[row.leadgen_id]);return row;});
 if(!event)break;
 try {if(await importMetaLead(event,await graphLead(event.leadgen_id)))imported++;}
 catch {await query("UPDATE wl.meta_lead_events SET locked_at=NULL,next_attempt_at=now()+least(attempts*interval '1 minute',interval '1 hour'),error='Lead import failed. Check Meta permissions and Page token; retry is queued.' WHERE leadgen_id=$1",[event.leadgen_id]);}
 }return imported;}
export async function metaLeadsStatus(){return {config:await metaLeadsConfig(),token_configured:Boolean(await secret("meta_leads_page_token")),app_secret_configured:Boolean(await secret("meta_leads_app_secret")),verify_token:await secret("meta_leads_verify_token"),callback_url:siteUrl()+"/api/webhooks/meta-leads",summary:(await query("SELECT count(*) FILTER(WHERE imported_at IS NOT NULL)::int imported,count(*) FILTER(WHERE imported_at IS NULL)::int pending,max(imported_at) last_imported_at FROM wl.meta_lead_events"))[0]};}
export async function saveMetaLeadsConfig(config:MetaLeadsConfig,pageToken:string,appSecret:string){
 const verifyToken=await secret("meta_leads_verify_token")||randomBytes(32).toString("hex");
 if(!pageToken&&!await secret("meta_leads_page_token"))throw new AppError("Enter a Page access token.");
 if(!appSecret&&!await secret("meta_leads_app_secret"))throw new AppError("Enter the Meta app secret for webhook verification.");
 await transaction(async q=>{if(pageToken)await saveSecret(q,"meta_leads_page_token",pageToken);if(appSecret)await saveSecret(q,"meta_leads_app_secret",appSecret);await saveSecret(q,"meta_leads_verify_token",verifyToken);await q("INSERT INTO wl.settings(key,value) VALUES('meta_leads',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=$1::jsonb,updated_at=now()",[JSON.stringify(config)]);});
}
