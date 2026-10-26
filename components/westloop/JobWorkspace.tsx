"use client";
import {useCallback,useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {Modal,action,type RecordData as R} from "./AdminControls";
import {JobPricingEditor} from "./JobPricingEditor";
import {JobCompensationEditor} from "./JobCompensationEditor";
import {JobPaymentPanel,loadJob} from "./JobPayments";
import {JobPhotos} from "./JobPhotos";
import {money,timeLabel} from "@/lib/platform/types";
import styles from "./JobWorkspace.module.css";
type Tab="Overview"|"Services & price"|"Team & pay"|"Payments"|"Photos";
export function JobWorkspace({booking,employees,rules,services,canPay,canCollect,staff,environment,onClose,onEditAppointment}:{booking:R;employees:R[];rules:R[];services:R[];canPay:boolean;canCollect:boolean;staff:boolean;environment:string;onClose:()=>void;onEditAppointment:(job:R)=>void}){
 const router=useRouter(),[current,setCurrent]=useState<R>({...booking,square_environment:environment}),[tab,setTab]=useState<Tab>("Overview"),[version,setVersion]=useState(0),[loading,setLoading]=useState(!staff),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const refresh=useCallback(async()=>{if(staff)return;setLoading(true);setError("");try{setCurrent(await loadJob(String(booking.id)) as typeof current);setVersion(v=>v+1);router.refresh();}catch(e){setError(e instanceof Error?e.message:"Could not refresh this job.");}finally{setLoading(false);}},[booking.id,staff,router]);
 useEffect(()=>{void refresh();},[refresh]);
 async function send(name:string){if(busy)return;setBusy(true);setError("");try{await action(name,{booking_id:current.id,request_id:crypto.randomUUID()});setNotice("Message queued. Check the customer timeline for delivery.");}catch(e){setError(e instanceof Error?e.message:"Could not queue message.");}finally{setBusy(false);}}
 const tabs:Tab[]=["Overview",...(!staff?["Services & price" as const]:[]),...(canPay?["Team & pay" as const]:[]),...(canCollect?["Payments" as const]:[]),"Photos"];
 const items=(Array.isArray(current.line_items)?current.line_items:[]) as R[];
 return <Modal title={`Job · ${current.reference}`} onClose={onClose} wide><div className={styles.workspace}>
  <div className={styles.identity}><div><h3>{String(current.customer_name||"Customer")}</h3><p>{String(current.vehicle||"")}</p><p>{String(current.booking_date)} · {timeLabel(Number(current.start_minute))} CT</p></div><span className="status-pill">{String(current.status).replaceAll("_"," ")}</span></div>
  <div className={styles.tabs} role="group" aria-label="Job sections">{tabs.map(name=><button key={name} aria-pressed={tab===name} onClick={()=>{setTab(name);setNotice("");}}>{name}</button>)}</div>
  {error&&<p className="error-message" role="alert">{error} <button onClick={()=>void refresh()}>Reload job</button></p>}
  {notice&&<p className="success-message" role="status">{notice}</p>}
  {loading?<p className={styles.loading} role="status">Loading the latest job details…</p>:<div key={`${tab}-${version}`}>
   {tab==="Overview"&&<div className={styles.summary}>
    {!staff&&<div className={styles.metrics}><div className={styles.metric}><span>Agreed service total</span><strong>{money(current.price_cents==null?null:Number(current.price_cents))}</strong></div><div className={styles.metric}><span>Received toward service</span><strong>{money(Number(current.collected_cents||0))}</strong></div><div className={styles.metric}><span>Remaining service balance</span><strong>{money(current.price_cents==null?null:Math.max(0,Number(current.price_cents)-Number(current.collected_cents||0)))}</strong></div></div>}
    <section><h3>Work to complete</h3>{items.length?<ul>{items.map(item=><li key={String(item.id)}>{String(item.name)}{Number(item.quantity)>1?` × ${item.quantity}`:""}{!staff&&<> · {item.quote_pending?"Quote pending":money(Number(item.quantity)*Number(item.unit_price_cents))}</>}</li>)}</ul>:<p>{String(current.service_name)}</p>}</section>
    <section><h3>Notes</h3><p>{String(current.notes||"No customer notes.")}</p>{!staff&&!!current.internal_notes&&<p className="small-note">Internal: {String(current.internal_notes)}</p>}</section>
    <div className={styles.actions}><button className="button" onClick={()=>onEditAppointment(current)}>Status, schedule & notes</button>{!staff&&<button onClick={()=>setTab("Services & price")}>Edit agreed price</button>}</div>
    {!staff&&<details><summary>Customer messages</summary><div className={styles.actions}>{!["completed","cancelled","no_show"].includes(String(current.status))&&<button disabled={busy} onClick={()=>void send("send_booking_confirmation")}>Send confirmation text</button>}{current.status==="completed"&&<button disabled={busy} onClick={()=>void send("request_review")}>Request review</button>}</div></details>}
   </div>}
   {tab==="Services & price"&&!staff&&<JobPricingEditor booking={current} services={services} onSaved={()=>void refresh()}/>}
   {tab==="Team & pay"&&canPay&&<JobCompensationEditor booking={current} employees={employees} rules={rules} onSaved={()=>void refresh()}/>}
   {tab==="Payments"&&canCollect&&<JobPaymentPanel booking={current} onSaved={()=>void refresh()}/>}
   {tab==="Photos"&&<JobPhotos bookingId={String(current.id)} reference={String(current.reference)} embedded/>}
  </div>}
 </div></Modal>;
}
