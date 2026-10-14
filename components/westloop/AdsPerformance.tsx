"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { money } from "@/lib/platform/types";
import { marketingWebsitePerformance } from "@/lib/marketing-performance";
import { marketingStreamLabel, marketingBudgetLabel, marketingStreams } from "@/lib/marketing-streams";
import type { metaAdsReportStatus, MetaAdsConfig } from "@/lib/integrations/meta-ads-reporting";
import type { report } from "@/lib/platform/reporting";
type Status=Awaited<ReturnType<typeof metaAdsReportStatus>>;
type Report=Awaited<ReturnType<typeof report>>;
export function AdsPerformance({report}:{report:Report}){
  const params=useSearchParams(),query=params.toString();
  const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[configure,setConfigure]=useState(false);
  const [account,setAccount]=useState(""),[campaigns,setCampaigns]=useState(""),[whole,setWhole]=useState(false),[goal,setGoal]=useState<MetaAdsConfig["conversion_action"]>("lead"),[token,setToken]=useState("");
  const endpoint="/api/admin/meta-ads?"+query;
  async function load(){const response=await fetch(endpoint,{cache:"no-store"});const data=await response.json();if(!response.ok)throw new Error(data.error||"Could not load ad reporting.");setStatus(data);return data as Status;}
  useEffect(()=>{let active=true;setStatus(null);setError("");const refresh=async()=>{try{const response=await fetch(endpoint,{cache:"no-store"});const data=await response.json();if(!response.ok)throw new Error(data.error||"Could not load ad reporting.");if(active)setStatus(data);}catch(e){if(active)setError(e instanceof Error?e.message:"Could not load ad reporting.");}};void refresh();const timer=setInterval(refresh,30000);return()=>{active=false;clearInterval(timer);};},[endpoint]);
  function edit(){const c=status?.config;setAccount(c?.account_id||"");setCampaigns(c?.campaign_ids.join(", ")||"");setWhole(c?.whole_account||false);setGoal(c?.conversion_action||"lead");setToken("");setConfigure(true);setError("");}
  async function save(action:"sync"|"configure"){
    setBusy(true);setError("");
    try{const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,...(action==="configure"?{config:{account_id:account.trim(),campaign_ids:campaigns.split(/[\s,]+/).filter(Boolean),whole_account:whole,conversion_action:goal},token}:{})})});const data=await response.json();if(!response.ok)throw new Error(data.error||"Could not sync Meta Ads.");setStatus(data);if(action==="configure"){setToken("");setConfigure(false);}}
    catch(e){setError(e instanceof Error?e.message:"Could not sync Meta Ads.");await load().catch(()=>{});}finally{setBusy(false);}
  }
  const payload=status?.report?.payload||null;
  const missing=!payload;
  const scopedMeta = status?.config && !status.config.whole_account ? status.config.campaign_ids : null;
  const comparison=marketingWebsitePerformance(report.campaigns,scopedMeta);
  return <section className="paper ads-performance">
    <p className="eyebrow">SPEND TO COLLECTED REVENUE</p><h2>Ad account performance</h2>
    <p>Compare each funded stream with its website enquiries, bookings and collected payments. A lead is someone asking for a quote or callback without reserving a time. A booking is a reserved appointment. Direct bookings are counted once, as bookings; converting a lead preserves its source. Ad-platform conversions follow Meta’s own attribution rules.</p>
    <div className="record-actions"><button type="button" onClick={edit} disabled={busy}>{status?.config?"Edit Meta connection":"Connect Meta Ads"}</button> <button type="button" onClick={()=>save("sync")} disabled={busy||!status?.config||!status?.token_configured}>{busy?"Syncing…":"Sync Meta report"}</button></div>
    {error&&<p role="alert" className="error-message">{error}</p>}
    {status?.report?.error&&<p role="status">{status.report.error} {payload?"Showing the last successful report; it may be stale.":"No verified ad metrics are available for this period."}</p>}
    <p className="small-note">Meta: {!status?"Checking connection…":!status.config||!status.token_configured?"Not connected":missing?"Configured; waiting for a successful report":`Last successful sync ${new Date(status.report!.synced_at!).toLocaleString("en-US",{timeZone:"America/Chicago"})} CT · ${payload.account_name} · USD · ad account timezone ${payload.timezone}`}. Google Ads accounts are not connected yet.</p>
    <div className="table-wrap"><table><thead><tr>{["Source / budget","Ad spend","Ad clicks","Ad conversions","Website enquiries","Website bookings","Collected revenue","Cost / booking","Revenue / spend"].map((h)=><th key={h}>{h}</th>)}</tr></thead><tbody>
      {marketingStreams.map((stream)=>{
        const website=comparison.streams[stream.name],metrics=stream.tag==="business-meta"?payload:null;
        const spend=metrics?.spend_cents??null,bookings=website?.bookings||0,revenue=website?.revenue||0;
        return <tr key={stream.tag}><td><strong>{marketingStreamLabel(stream.name)}</strong><small>{marketingBudgetLabel(stream.budget)}-funded</small></td><td>{spend===null?"Not synced":money(spend)}</td><td>{metrics?metrics.clicks.toLocaleString():"Not synced"}</td><td>{metrics?metrics.conversions.toLocaleString():"Not synced"}</td><td>{website?.leads||0}</td><td>{bookings}</td><td>{money(revenue)}</td><td>{spend!==null&&bookings?money(spend/bookings):"—"}</td><td>{spend!==null&&spend>0?(revenue/spend).toFixed(2)+"×":"—"}</td></tr>;
      })}
      {comparison.other.map((row)=><tr key={row.channel}><td>{row.channel}{["Google Ads","Meta Ads"].includes(row.channel)&&<small>Legacy / unassigned stream</small>}</td><td>{["Google Ads","Meta Ads"].includes(row.channel)?"Not synced":"Not applicable"}</td><td>Not synced</td><td>Not applicable</td><td>{row.leads}</td><td>{row.bookings}</td><td>{money(row.revenue)}</td><td>—</td><td>—</td></tr>)}
    </tbody></table></div>
    <p className="small-note">Date range follows the selected reporting filter. Website activity uses Central Time; ad metrics use the ad account’s timezone. Collected revenue is payment-date revenue less refunds, not Meta’s reported conversion value. Website collections can include tips/tax; commission calculations use the separate service subtotal. These are period comparisons, not lifetime revenue per acquired customer. When specific Meta campaigns are selected, website links must use utm_campaign equal to the Meta campaign ID. Unmatched website activity is listed separately and excluded from that campaign comparison. Manual spend entries remain in the channel report below and are not added to imported Meta spend.</p>
    {payload&&<details><summary>Meta campaign breakdown</summary><p>Conversion action: {payload.conversion_action}. Clicks include all ad clicks; link clicks are shown separately.</p><div className="table-wrap"><table><thead><tr>{["Campaign","Spend","Impressions","Clicks","Link clicks","Ad conversions","Reported conversion value"].map((h)=><th key={h}>{h}</th>)}</tr></thead><tbody>{payload.campaigns.map((r)=><tr key={r.campaign_id}><td>{r.campaign_name}<small className="compact-id" title={r.campaign_id}>ID · {r.campaign_id.slice(-6)}</small></td><td>{money(r.spend_cents)}</td><td>{r.impressions}</td><td>{r.clicks}</td><td>{r.link_clicks}</td><td>{r.conversions}</td><td>{money(r.conversion_value_cents)}</td></tr>)}</tbody></table></div></details>}
    {configure&&<form className="ads-connection-form" onSubmit={(e)=>{e.preventDefault();void save("configure");}}>
      <h3>Connect Business Meta</h3><p>Use an ad-account reporting token with ads_read access. A Pixel ID or Conversions API token alone does not provide spend/click reporting. Tokens are stored encrypted and are never returned to the browser.</p>
      <label>Meta ad account ID<input required value={account} onChange={(e)=>setAccount(e.target.value)} placeholder="act_123456789"/></label>
      <label>Reporting access token<input type="password" autoComplete="new-password" required={!status?.token_configured} value={token} onChange={(e)=>setToken(e.target.value)} placeholder={status?.token_configured?"Leave blank to retain existing token":"Enter securely here"}/></label>
      <label><input type="checkbox" checked={whole} onChange={(e)=>setWhole(e.target.checked)}/> This ad account is exclusively West Loop Ceramics; include all its campaigns.</label>
      {!whole&&<label>West Loop campaign IDs<input required value={campaigns} onChange={(e)=>setCampaigns(e.target.value)} placeholder="Comma-separated campaign IDs"/><small>Set utm_campaign to the campaign ID on each ad link so its website revenue matches this scope.</small></label>}
      <label>Meta conversion action to compare<select value={goal} onChange={(e)=>setGoal(e.target.value as MetaAdsConfig["conversion_action"])}><option value="lead">Leads (Meta aggregate)</option><option value="onsite_conversion.lead_grouped">Meta instant-form leads</option><option value="offsite_conversion.fb_pixel_lead">Website Lead events</option><option value="purchase">Purchases (Meta aggregate)</option><option value="offsite_conversion.fb_pixel_purchase">Website Purchase events</option></select></label>
      <button type="submit" disabled={busy}>{busy?"Testing connection…":"Save & test connection"}</button> <button type="button" disabled={busy} onClick={()=>{setToken("");setConfigure(false);}}>Cancel</button>
      <p className="small-note">This connection reads account details and Insights only. It cannot change ads or budgets through this application. Railway’s META_ADS_REPORTING_TOKEN, if set, overrides the saved token. Native lead-form contact details require a separate lead import connection.</p>
    </form>}
  </section>;
}
