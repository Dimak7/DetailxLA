import { createHash } from "node:crypto";
import { z } from "zod";
import { query, transaction } from "../platform/db";
import { secret, saveSecret } from "../platform/settings";
import { AppError } from "../platform/auth";
import { dateToday } from "../platform/types";
export const metaAdsConfigSchema = z.object({
  account_id: z.string().trim().regex(/^(?:act_)?\d{5,30}$/).transform((v)=>v.replace(/^act_/,"")),
  campaign_ids: z.array(z.string().regex(/^\d{5,30}$/)).max(100).default([]),
  whole_account: z.boolean().default(false),
  conversion_action: z.enum(["lead","purchase","offsite_conversion.fb_pixel_lead","offsite_conversion.fb_pixel_purchase","onsite_conversion.lead_grouped"]).default("lead"),
}).refine((v)=>v.whole_account || v.campaign_ids.length>0,{message:"Select campaign IDs or confirm this account is exclusively for West Loop Ceramics."});
export type MetaAdsConfig = z.infer<typeof metaAdsConfigSchema>;
export type MetaCampaignMetrics = {campaign_id:string;campaign_name:string;spend_cents:number;impressions:number;clicks:number;link_clicks:number;conversions:number;conversion_value_cents:number};
export type MetaAdsMetrics = {currency:string;timezone:string;account_name:string;conversion_action:string;campaigns:MetaCampaignMetrics[];spend_cents:number;impressions:number;clicks:number;link_clicks:number;conversions:number;conversion_value_cents:number};
export async function metaAdsConfig() {
  const row=(await query<{value:unknown}>("SELECT value FROM wl.settings WHERE key='meta_ads_reporting'"))[0];
  return row ? metaAdsConfigSchema.parse(row.value) : null;
}
export function metaScopeKey(config:MetaAdsConfig) {
  return createHash("sha256").update(JSON.stringify({...config,campaign_ids:config.whole_account?[]:[...config.campaign_ids].sort()})).digest("hex");
}
export async function saveMetaAdsConfig(input:unknown,token:string,actor:string) {
  const config=metaAdsConfigSchema.parse(input);
  if (!token && !(await secret("meta_ads_reporting_token"))) throw new AppError("Enter a Meta reporting token with ads_read access.");
  await transaction(async(q)=>{
    if (token) await saveSecret(q,"meta_ads_reporting_token",token);
    await q("INSERT INTO wl.settings(key,value) VALUES('meta_ads_reporting',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=$1::jsonb,updated_at=now()",[JSON.stringify(config)]);
    await q("INSERT INTO wl.timeline(id,type,body,actor_id) VALUES(gen_random_uuid(),'meta_ads_connection','Updated Meta Ads reporting account and campaign scope',$1)",[actor]);
  });
  return config;
}
const number = (value:unknown) => {const n=Number(value ?? 0);if(!Number.isFinite(n)||n<0)throw new AppError("Meta returned invalid report metrics.",502);return n;};
export function metaMoneyCents(value:unknown) {return Math.round(number(value)*100);}
export function aggregateMetaRows(rows:Array<Record<string,unknown>>,config:MetaAdsConfig,account:{currency:string;timezone:string;name:string}):MetaAdsMetrics {
  if(account.currency!=="USD")throw new AppError("This dashboard uses USD. Connect a USD ad account; currencies are not combined automatically.",400);
  const campaigns=new Map<string,MetaCampaignMetrics>();
  for(const row of rows){
    const id=String(row.campaign_id||"");
    if(!id || (!config.whole_account&&!config.campaign_ids.includes(id)))throw new AppError("Meta returned data outside the selected campaign scope.",502);
    if(row.account_currency!==account.currency)throw new AppError("Meta returned mixed or missing report currencies.",502);
    const current=campaigns.get(id)||{campaign_id:id,campaign_name:String(row.campaign_name||id),spend_cents:0,impressions:0,clicks:0,link_clicks:0,conversions:0,conversion_value_cents:0};
    const actions=Array.isArray(row.actions)?row.actions as Array<{action_type:string;value:unknown}>:[];
    const values=Array.isArray(row.action_values)?row.action_values as Array<{action_type:string;value:unknown}>:[];
    current.spend_cents+=metaMoneyCents(row.spend);current.impressions+=number(row.impressions);current.clicks+=number(row.clicks);current.link_clicks+=number(row.inline_link_clicks);
    // One explicit action type; never add overlapping lead/purchase aggregates together.
    current.conversions+=number(actions.find((a)=>a.action_type===config.conversion_action)?.value);
    current.conversion_value_cents+=metaMoneyCents(values.find((a)=>a.action_type===config.conversion_action)?.value);
    campaigns.set(id,current);
  }
  const all=[...campaigns.values()];
  return {currency:account.currency,timezone:account.timezone,account_name:account.name,conversion_action:config.conversion_action,campaigns:all,
    spend_cents:all.reduce((s,r)=>s+r.spend_cents,0),impressions:all.reduce((s,r)=>s+r.impressions,0),clicks:all.reduce((s,r)=>s+r.clicks,0),link_clicks:all.reduce((s,r)=>s+r.link_clicks,0),conversions:all.reduce((s,r)=>s+r.conversions,0),conversion_value_cents:all.reduce((s,r)=>s+r.conversion_value_cents,0)};
}
async function graph(path:string,params:URLSearchParams,token:string) {
  const version=process.env.META_ADS_API_VERSION||"v26.0";
  if(!/^v\d+\.0$/.test(version))throw new AppError("Invalid Meta reporting API version.");
  const response=await fetch(`https://graph.facebook.com/${version}/${path}?${params}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000),cache:"no-store"});
  const data=await response.json() as Record<string,unknown>;
  if(!response.ok || data.error)throw new AppError(`Meta reporting request failed (HTTP ${response.status}). Check the account ID and ads_read permission; expired tokens must be replaced.`,502);
  return data;
}
export async function fetchMetaAdsReport(config:MetaAdsConfig,start:string,end:string,token:string):Promise<MetaAdsMetrics> {
  const account=await graph(`act_${config.account_id}`,new URLSearchParams({fields:"id,name,currency,timezone_name"}),token);
  if(String(account.id)!==`act_${config.account_id}`)throw new AppError("Meta returned a different ad account.",502);
  if(account.currency!=="USD")throw new AppError("Connect a USD ad account; automatic currency conversion is not enabled.");
  const params=new URLSearchParams({fields:"campaign_id,campaign_name,account_currency,spend,impressions,clicks,inline_link_clicks,actions,action_values",level:"campaign",time_range:JSON.stringify({since:start,until:end}),action_report_time:"conversion",use_account_attribution_setting:"true",limit:"500"});
  if(!config.whole_account)params.set("filtering",JSON.stringify([{field:"campaign.id",operator:"IN",value:config.campaign_ids}]));
  const rows:Array<Record<string,unknown>>=[];const cursors=new Set<string>();const deadline=Date.now()+60000;
  for(let page=0;page<20;page++){
    if(Date.now()>deadline)throw new AppError("Meta report timed out. Choose a narrower date range and retry.",502);
    const data=await graph(`act_${config.account_id}/insights`,params,token);
    if(!Array.isArray(data.data))throw new AppError("Meta returned an incomplete report.",502);
    rows.push(...data.data);
    const paging=data.paging as {next?:string;cursors?:{after?:string}}|undefined;
    if(!paging?.next)return aggregateMetaRows(rows,config,{currency:String(account.currency),timezone:String(account.timezone_name||"Unknown"),name:String(account.name||config.account_id)});
    const after=paging.cursors?.after;
    if(!after||cursors.has(after))throw new AppError("Meta pagination did not complete; previous report was retained.",502);
    cursors.add(after);params.set("after",after);
  }
  throw new AppError("Meta report is too large. Choose a narrower date range.",400);
}
function validateRange(start:string,end:string) {
  const days=(Date.parse(end)-Date.parse(start))/86400000;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||!Number.isFinite(days)||days<0||days>365||end>dateToday())throw new AppError("Choose a reporting period of up to one year ending today or earlier.");
}
export async function metaAdsReportStatus(start:string,end:string) {
  const config=await metaAdsConfig(),tokenConfigured=Boolean(await secret("meta_ads_reporting_token"));
  const report=config?(await query<{payload:MetaAdsMetrics|null;synced_at:string|null;attempted_at:string|null;locked_at:string|null;error:string}>("SELECT payload,synced_at,attempted_at,locked_at,error FROM wl.meta_ads_reports WHERE scope_key=$1 AND start_day=$2 AND end_day=$3",[metaScopeKey(config),start,end]))[0]||null:null;
  return {config,token_configured:tokenConfigured,report};
}
export async function syncMetaAdsReport(start:string,end:string) {
  validateRange(start,end);
  const config=await metaAdsConfig(),token=await secret("meta_ads_reporting_token");
  if(!config||!token)throw new AppError("Connect the Meta ad account and reporting token first.");
  const scope=metaScopeKey(config),params=[scope,start,end];
  await query("INSERT INTO wl.meta_ads_reports(scope_key,start_day,end_day) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",params);
  const claimed=await query("UPDATE wl.meta_ads_reports SET locked_at=now(),attempted_at=now() WHERE scope_key=$1 AND start_day=$2 AND end_day=$3 AND (locked_at IS NULL OR locked_at<now()-interval '5 minutes') AND (attempted_at IS NULL OR attempted_at<now()-interval '1 minute') RETURNING scope_key",params);
  if(!claimed.length)return;
  try {
    const payload=await fetchMetaAdsReport(config,start,end,token);
    await query("UPDATE wl.meta_ads_reports SET payload=$4::jsonb,synced_at=now(),locked_at=NULL,error='' WHERE scope_key=$1 AND start_day=$2 AND end_day=$3",[...params,JSON.stringify(payload)]);
  }catch(e){
    const message=e instanceof AppError?e.message:"Meta reporting sync failed. Previous data was retained; check the account connection and retry.";
    await query("UPDATE wl.meta_ads_reports SET locked_at=NULL,error=$4 WHERE scope_key=$1 AND start_day=$2 AND end_day=$3",[...params,message]);
    throw new AppError(message,502);
  }
}
