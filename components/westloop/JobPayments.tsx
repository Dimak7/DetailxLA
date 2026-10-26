"use client";
import {useCallback,useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {Modal,action,type RecordData as R} from "./AdminControls";
import {money} from "@/lib/platform/types";
import styles from "./JobWorkspace.module.css";
export async function loadJob(id:string){
 const response=await fetch(`/api/manage?section=bookings&id=${encodeURIComponent(id)}`,{cache:"no-store"});
 const data=await response.json();if(!response.ok)throw Error(data.error||"Could not refresh this job.");
 if(!data.rows?.[0])throw Error("This job is unavailable. Refresh the bookings list.");
 return {...data.rows[0],square_environment:data.squareEnvironment} as R;
}
export function JobPayments({booking,embedded=false}:{booking:R;embedded?:boolean}){
 const [open,setOpen]=useState(embedded),[current,setCurrent]=useState(booking),[loading,setLoading]=useState(false),[error,setError]=useState("");
 const refresh=useCallback(async()=>{setLoading(true);setError("");try{setCurrent(await loadJob(String(booking.id)));}catch(e){setError(e instanceof Error?e.message:"Could not refresh payments.");}finally{setLoading(false);}},[booking.id]);
 useEffect(()=>{if(open)void refresh();},[open,refresh]);
 const content=loading?<p role="status">Refreshing payments…</p>:error?<p role="alert">{error} <button onClick={()=>void refresh()}>Retry</button></p>:<JobPaymentPanel key={String(current.updated_at)} booking={current} onSaved={()=>void refresh()}/>;
 return embedded?content:<><button onClick={()=>setOpen(true)}>Collect payment</button>{open&&<Modal title={`Payments · ${booking.reference}`} onClose={()=>setOpen(false)} wide>{content}</Modal>}</>;
}
export function JobPaymentPanel({booking,onSaved}:{booking:R;onSaved:()=>void}){
 const router=useRouter(),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[url,setUrl]=useState(""),[cash,setCash]=useState(""),[tip,setTip]=useState("0"),[cashOpen,setCashOpen]=useState(false),[requestId,setRequestId]=useState(()=>crypto.randomUUID());
 const invoice=booking.square_invoice as R|undefined,total=booking.price_cents==null?null:Number(booking.price_cents),paid=Number(booking.collected_cents||0),due=total===null?null:Math.max(0,total-paid),deposit=Number(booking.deposit_cents||0),tips=Number(booking.tip_cents||0),depositDue=Math.max(0,deposit-paid);
 const link=url;
 const [matches,setMatches]=useState<R[]|null>(null),[selected,setSelected]=useState("");
 async function findSquare(){if(busy)return;setBusy(true);setError("");try{const result=await action("list_job_square_payments",{booking_id:booking.id});setMatches(result.payments as R[]);setSelected("");}catch(e){setError(e instanceof Error?e.message:"Could not load Square receipts.");}finally{setBusy(false);}}
 async function matchSquare(){if(busy||!selected)return;setBusy(true);setError("");try{await action("link_job_square_payment",{booking_id:booking.id,payment_id:selected});setMatches(null);router.refresh();onSaved();}catch(e){setError(e instanceof Error?e.message:"Could not match the receipt.");}finally{setBusy(false);}}
 async function save(name:string,kind="balance"){
  if(busy)return;setBusy(true);setError("");setNotice("");try{
   const result=await action(name,{booking_id:booking.id,kind,request_id:crypto.randomUUID()});
   if(result?.url)setUrl(String(result.url));
   if(result?.queued)setNotice("Payment text queued. Delivery is recorded in the customer timeline.");
   if(name==="refresh_job_payments"){onSaved();setNotice("Square payments refreshed.");}
   router.refresh();
  }catch(e){setError(e instanceof Error?e.message:"Payment action failed.");}finally{setBusy(false);}
 }
 async function recordCash(e:React.FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError("");try{
  await action("record_job_cash_payment",{booking_id:booking.id,request_id:requestId,amount_cents:Math.round(Number(cash)*100),tip_cents:Math.round(Number(tip)*100)});
  setRequestId(crypto.randomUUID());setCashOpen(false);setCash("");setTip("0");setNotice("Cash payment recorded. The service balance and tip are updated.");router.refresh();onSaved();
 }catch(e){setError(e instanceof Error?e.message:"Could not record payment.");}finally{setBusy(false);}}
 return <div className={styles.workspace}>
  {booking.square_environment==="sandbox"&&<p role="status"><strong>Square sandbox · test payments only</strong></p>}
  <div className={styles.metrics}><div className={styles.metric}><span>Agreed service total</span><strong>{money(total)}</strong></div><div className={styles.metric}><span>Service payments received</span><strong>{money(paid)}</strong></div><div className={styles.metric}><span>Service balance remaining</span><strong>{money(due)}</strong></div></div>
  <dl className={styles.breakdown}><div><dt>Requested deposit · included in total</dt><dd>{money(deposit)}</dd></div><div><dt>Tips recorded · separate from services</dt><dd>{money(tips)}</dd></div></dl>
  <p className={styles.notice}>{total===null?"Agree all service prices in Services & price before collecting payment.":due===0?"Service paid in full. Tips are tracked separately.":paid>0?`${money(paid)} has been received toward the service. Collect ${money(due)} before handover.`:`Collect ${money(due)} for the service, or take a deposit first.`}</p>
  {paid>Number(total)&&total!==null&&<p role="status">Payments exceed the agreed service total by {money(paid-total)}. Review the receipts before refunding through the original payment method.</p>}
  <div className={styles.paymentOptions}>
   <section className={styles.paymentOption}><div><h3>Card / Square</h3><p className="small-note">Open the secure Square payment page for the customer. Card details are entered in Square.</p></div>
    {link?<div className={styles.paymentLink}><a className="button" href={link} target="_blank" rel="noopener noreferrer">Open Square payment page</a><label className="field"><span>Customer payment link</span><input readOnly value={link} onFocus={e=>e.currentTarget.select()}/></label>{invoice&&<p className="small-note">This job has an active Square invoice. It tracks the deposit and remaining balance together.</p>}</div>:<div className={styles.actions}><button className="button" disabled={busy||total===null||!due} onClick={()=>void save("create_payment")}>{due===0?"Service paid in full":`Collect ${money(due)}`}</button>{depositDue>0&&depositDue!==due&&<button disabled={busy||total===null} onClick={()=>void save("create_payment","deposit")}>Deposit {money(depositDue)}</button>}</div>}
    <button disabled={busy} onClick={()=>void save("refresh_job_payments")}>Refresh Square payments</button>
    <details><summary>Send a payment link</summary><div className={styles.actions}>{depositDue>0&&<button disabled={busy||total===null} onClick={()=>void save("send_booking_payment_text","deposit")}>Text deposit link</button>}<button disabled={busy||total===null||!due} onClick={()=>void save("send_booking_payment_text")}>Text balance link</button></div></details>
   </section>
   <section className={styles.paymentOption}><div><h3>Cash received</h3><p className="small-note">Record actual cash collected. Keep the service amount and tip separate.</p></div>
    {!cashOpen?<button disabled={busy||total===null||booking.square_environment==="sandbox"} onClick={()=>{setCash(String((due||0)/100));setCashOpen(true);}}>Record cash payment</button>:<form className={styles.cashForm} onSubmit={recordCash}>
     <label className="field"><span>For the service ($)</span><input required type="number" min={0} step="0.01" value={cash} onChange={e=>setCash(e.target.value)}/></label><label className="field"><span>Additional cash tip ($)</span><input required type="number" min={0} step="0.01" value={tip} onChange={e=>setTip(e.target.value)}/></label>
     <strong>Total cash received: {money(Math.round((Number(cash)+Number(tip))*100))}</strong>
     <p className="small-note">For a $25 wash and a $75 tip, enter 25 for the service and 75 for the tip. Don’t enter tips already recorded by Square.</p>
     <div className={styles.actions}><button className="button" disabled={busy}>{busy?"Recording…":"Confirm cash received"}</button><button type="button" disabled={busy} onClick={()=>setCashOpen(false)}>Cancel</button></div>
    </form>}
   </section>
  </div>
  <section className={styles.section}><div className={styles.sectionHeading}><div><h3>Already paid on your Square reader?</h3><p className="small-note">Match the existing receipt to this job. Its service payment and tip sync once.</p></div><button disabled={busy||total===null} onClick={()=>void findSquare()}>{busy?"Checking…":"Find Square receipt"}</button></div>
  {matches!==null&&(matches.length?<div className={styles.cashForm}><label className="field"><span>Choose the customer’s receipt</span><select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Select a Square payment</option>{matches.map(p=><option key={String(p.payment_id)} value={String(p.payment_id)}>{new Date(String(p.paid_at)).toLocaleString("en-US",{timeZone:"America/Chicago",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})} · {money(Number(p.amount_cents))} total · {money(Number(p.tip_cents))} tip · {String(p.payment_method)} · …{String(p.payment_id).slice(-6)}</option>)}</select></label>{selected&&(()=>{const payment=matches.find(p=>p.payment_id===selected)!;return <div className={styles.notice}><p>Apply {money(Number(payment.principal_cents))} to the service and {money(Number(payment.tip_cents))} as the tip.</p>{!!payment.receipt_url&&<a className="text-link" href={String(payment.receipt_url)} target="_blank" rel="noopener noreferrer">Review Square receipt</a>}</div>;})()}<button className="button" disabled={busy||!selected} onClick={()=>void matchSquare()}>Match receipt to this job</button></div>:<p role="status" className="small-note">No unmatched Square receipts found. Check the connected Square account and try again after the payment completes.</p>)}
  </section>
  {notice&&<p className="success-message" role="status">{notice}</p>}{error&&<p className="error-message" role="alert">{error}</p>}
  <p className="small-note">Employee percentages use the full agreed service value after discounts. A deposit reduces the customer’s balance; it does not reduce the employee’s commission.</p>
 </div>;
}
