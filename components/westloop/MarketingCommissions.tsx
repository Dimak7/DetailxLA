"use client";
import { useEffect, useState } from "react";
import { money } from "@/lib/platform/types";
import { commissionPaymentStatus, weeklyPayouts } from "@/lib/marketing-payouts";
import { marketingStreamLabel, marketingBudgetLabel, marketingStreams } from "@/lib/marketing-streams";
import type { marketingCommissionRows } from "@/lib/platform/marketing-commissions";
type Row = Awaited<ReturnType<typeof marketingCommissionRows>>[number];
export function MarketingCommissions() {
  const [rows,setRows] = useState<Row[]>([]), [error,setError] = useState(""), [loading,setLoading] = useState(true), [busy,setBusy] = useState(false);
  const [selected,setSelected] = useState<Row|null>(null), [verified,setVerified] = useState(false), [reference,setReference] = useState("");
  const [payouts,setPayouts] = useState<Array<{id:string;amount_cents:number;reference:string;created_at:string;booking_reference:string;recorded_by:string}>>([]);
  const [origin,setOrigin] = useState(""), [copied,setCopied] = useState(""), [metaCampaign,setMetaCampaign] = useState("");
  async function load() {
    const res = await fetch("/api/admin/marketing-commissions",{cache:"no-store"});
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load commissions.");
    setRows(data.rows); setPayouts(data.payouts || []);
  }
  useEffect(() => { setOrigin(location.origin); fetch("/api/admin/meta-ads",{cache:"no-store"}).then(r=>r.json()).then(data=>{if(data.config && !data.config.whole_account && data.config.campaign_ids.length===1)setMetaCampaign(data.config.campaign_ids[0]);}).catch(()=>{}); load().catch((e: Error) => setError(e.message)).finally(() => setLoading(false)); },[]);
  async function save() {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/admin/marketing-commissions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({booking_id:selected.id,action:selected.can_approve?"approve":"record_paid",reference,verified_service_subtotal:verified})});
      const data = await res.json(); if (!res.ok) throw new Error(data.error || "Could not save commission.");
      await load(); setSelected(null);
    } catch (e) {setError(e instanceof Error?e.message:"Could not save commission.");} finally {setBusy(false);}
  }
  return <section className="paper marketing-commissions">
    <p className="eyebrow">MARKETING EARNINGS</p><h2>Your earnings & payouts</h2>
    <p>Your earnings calculate automatically using each source’s agreed rate. Only a customer’s first completed, fully paid job qualifies, after discounts and excluding tax and tips. New bookings stay pending until those requirements are met.</p>
    <div className="marketing-stream-links">{marketingStreams.map((stream) => {
      const link = `${origin}/booking?utm_source=${stream.channel}&utm_medium=${stream.channel === "google" ? "cpc" : "paid_social"}&lead_stream=${stream.tag}${stream.tag==="business-meta"&&metaCampaign?`&utm_campaign=${metaCampaign}`:""}`;
      return <article key={stream.tag}><strong>{marketingStreamLabel(stream.name)}</strong><small>{marketingBudgetLabel(stream.budget)}-funded ads</small><div className="tracking-link-actions"><a href={link} target="_blank" rel="noreferrer">Open booking link ↗</a><button type="button" onClick={()=>navigator.clipboard.writeText(link).then(()=>setCopied(stream.tag)).catch(()=>setError("Could not copy. Open the link and copy its address."))}>{copied===stream.tag?"Copied":"Copy link"}</button></div><details><summary>View tracking URL</summary><input readOnly value={link} aria-label={`${marketingStreamLabel(stream.name)} tracking link`} onFocus={(e) => e.target.select()}/></details></article>;
    })}</div>
    <p className="small-note">Use the same query parameters on quote/contact pages. Add a campaign tag to distinguish campaigns. Phone enquiries need a separate number per stream or a manually verified source. Meta instant forms must be imported as leads with their stream; they are not connected automatically. Older unassigned sources need review before earnings can be calculated.</p>
    {error && <p role="alert" className="error-message">{error}</p>}
    {loading ? <p>Loading commissions…</p> : <>
      <div className="stats-grid">
        <article className="stat"><p>Revenue brought in</p><strong>{money(rows.reduce((sum,r)=>sum+Math.max(0,r.collected_cents-r.refunded_cents),0))}</strong><small>Tracked collections less refunds and tips; may include tax.</small></article>
        <article className="stat"><p>Your total earnings</p><strong>{money(rows.reduce((sum,r)=>sum+r.earned_cents,0))}</strong><small>Eligible jobs, calculated automatically.</small></article>
        <article className="stat"><p>Ready for payout</p><strong>{money(rows.reduce((sum,r)=>sum+Math.max(0,r.earned_cents-r.paid_cents),0))}</strong><small>Review the service subtotal before recording payment.</small></article>
        <article className="stat"><p>Paid to you</p><strong>{money(rows.reduce((sum,r)=>sum+r.paid_cents,0))}</strong><small>Recorded payments across all weeks.</small></article>
      </div>
      <h3>Weekly payouts</h3><p className="small-note">Monday–Sunday, grouped by job completion in Chicago time. Unpaid balances carry forward. Recording a payout logs money already transferred.</p>
      {weeklyPayouts(rows).length ? <div className="table-wrap"><table><thead><tr><th>Week starting</th><th>Jobs</th><th>Your earnings</th><th>Paid</th><th>Ready for payout</th></tr></thead><tbody>{weeklyPayouts(rows).map(week=><tr key={week.week}><td>{week.week}</td><td>{week.count}</td><td>{money(week.earnings_cents)}</td><td>{money(week.paid_cents)}</td><td>{money(week.ready_cents)}</td></tr>)}</tbody></table></div> : <p>No completed, paid jobs ready for a weekly payout yet.</p>}
      {rows.length ? <div className="table-wrap"><table><thead><tr>{["Booking / customer","Stream / budget","Service subtotal","Your earnings","Paid to you","Payout status"].map((x)=><th key={x}>{x}</th>)}</tr></thead><tbody>{rows.map((r)=><tr key={r.id}>
        <td><strong>{r.customer_name}</strong><a className="compact-id" title={r.reference} href={`/admin/bookings?search=${encodeURIComponent(r.reference)}`}>{r.reference}</a><small>{r.booking_date}</small><small>{r.service_name}</small></td>
        <td>{marketingStreamLabel(r.lead_stream)}</td>
        <td>{r.price_cents===null?"Quote pending":money(r.basis_cents)}</td><td>{money(r.earned_cents)}</td><td>{money(r.paid_cents)}</td>
        <td><span className="status-pill">{commissionPaymentStatus(r)}</span><small>{r.state === "Awaiting full payment"?"Customer payment outstanding":r.state === "Awaiting completion"?"Job not completed":r.state.startsWith("Repeat")?"First job only":r.can_approve?"Subtotal review needed":""}</small>{(r.can_approve || r.due_cents>0) && <button type="button" disabled={busy} onClick={()=>{setSelected(r);setVerified(false);setReference("");setError("");}}>{r.can_approve?"Review subtotal":"Record paid"}</button>}</td>
      </tr>)}</tbody></table></div> : <p>No bookings tagged with these commission streams yet.</p>}
    </>}
    {payouts.length > 0 && <details><summary>Recent recorded commission payments</summary><ul>{payouts.map((p)=><li key={p.id}>{p.booking_reference} · {money(p.amount_cents)} · {p.reference} · recorded by {p.recorded_by} on {new Date(p.created_at).toLocaleDateString("en-US",{timeZone:"America/Chicago"})}</li>)}</ul></details>}
    {selected && <div className="marketing-commission-review" role="region" aria-label="Review commission">
      <h3>{selected.can_approve?"Approve commission":"Record an existing payment"}: {selected.reference}</h3>
      <p>{marketingStreamLabel(selected.lead_stream)} · {money(selected.can_approve?selected.earned_cents:selected.due_cents)}. Recording a payout does not transfer money.</p>
      <label><input type="checkbox" checked={verified} onChange={(e)=>setVerified(e.target.checked)}/> I verified the marketing source, first-job eligibility and service subtotal excluding tax and tips.</label>
      {!selected.can_approve && <label>Payment / transfer reference<input value={reference} maxLength={240} onChange={(e)=>setReference(e.target.value)}/></label>}
      <button type="button" disabled={busy || !verified || (!selected.can_approve && !reference.trim())} onClick={save}>{busy?"Saving…":selected.can_approve?"Approve":"Record paid"}</button> <button type="button" disabled={busy} onClick={()=>setSelected(null)}>Cancel</button>
    </div>}
    <p className="small-note">Refunds reduce the service basis conservatively. Refunds or reopened jobs after a payout appear as adjustments; payout history is retained. Square/POS payments must be linked to the booking to qualify. These totals cover all tagged bookings, independent of the date filter above.</p>
  </section>;
}
