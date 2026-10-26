"use client";
import {useState} from "react";
import {action,type RecordData as R} from "./AdminControls";
import {money} from "@/lib/platform/types";
import styles from "./JobWorkspace.module.css";
type Item={id?:string;service_id:string|null;kind:"base_service"|"upsell";name:string;quantity:number;price:string;key:string};
type Discount={kind:"fixed"|"percent";value:string;reason:string};
export function JobPricingEditor({booking,services,onSaved}:{booking:R;services:R[];onSaved:()=>void}) {
 const initial=Array.isArray(booking.line_items)&&booking.line_items.length?booking.line_items as R[]:[{service_id:booking.service_id,kind:"base_service",name:booking.service_name,quantity:1,unit_price_cents:booking.price_cents,quote_pending:booking.price_cents==null}];
 const snapshot=booking.service_snapshot as R|undefined;
 const selectedServices=Array.isArray(snapshot?.selected_services)?snapshot.selected_services as R[]:[];
 const [items,setItems]=useState<Item[]>(()=>initial.map((item,i)=>({id:item.id?String(item.id):undefined,key:String(item.id||i),service_id:item.service_id?String(item.service_id):null,kind:item.kind as Item["kind"],name:String(item.name),quantity:Number(item.quantity),price:item.quote_pending||(booking.price_cents==null&&item.kind==="base_service"&&selectedServices.some(service=>service.id===item.service_id&&service.base_cents===null))?"":String(Number(item.unit_price_cents)/100)})));
 const [discounts,setDiscounts]=useState<Discount[]>(()=>((booking.discounts||[]) as R[]).map(d=>({kind:d.kind as Discount["kind"],value:String(Number(d.value)/100),reason:String(d.reason)})));
 const [deposit,setDeposit]=useState(String(Number(booking.deposit_cents||0)/100)),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const gross=items.reduce((sum,item)=>sum+Math.round(Number(item.price||0)*100)*item.quantity,0);
 const discount=discounts.reduce((sum,d)=>sum+(d.kind==="percent"?Math.round(gross*Number(d.value||0)/100):Math.round(Number(d.value||0)*100)),0);
 const quoted=items.some(item=>item.price===""),total=Math.max(0,gross-discount);
 function change(index:number,patch:Partial<Item>){setItems(current=>current.map((item,i)=>i===index?{...item,...patch}:item));}
 async function save(e:React.FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError("");try{
 await action("save_job_pricing",{booking_id:booking.id,expected_updated_at:booking.updated_at,items:items.map(({key,price,...item})=>({...item,unit_price_cents:price===""?null:Math.round(Number(price)*100)})),discounts:discounts.map(d=>({...d,value:Math.round(Number(d.value)*100)})),deposit_cents:Math.round(Number(deposit)*100)});onSaved();
 }catch(e){setError(e instanceof Error?e.message:"Could not save job prices.");}finally{setBusy(false);}}
 return <form onSubmit={save} className={styles.editor}>
  <div><h3>Services & agreed prices</h3><p className="small-note">Enter the price agreed with the customer. A blank price means a quote is still needed. Upgrades stay separate so each can have its own employee pay rate.</p></div>
  <div className={styles.itemList}>{items.map((item,index)=><div className={styles.item} key={item.key}>
   <label className="field"><span>{item.kind==="upsell"?"Upgrade":"Service"}</span><input required minLength={2} maxLength={160} value={item.name} onChange={e=>change(index,{name:e.target.value})}/></label>
   <label className="field"><span>Qty</span><input aria-label={`Quantity for ${item.name}`} type="number" min={1} max={100} required value={item.quantity} onChange={e=>change(index,{quantity:Number(e.target.value)})}/></label>
   <label className="field"><span>Agreed price ($)</span><input aria-label={`Price for ${item.name}`} type="number" min={0} step="0.01" placeholder="By quote" value={item.price} onChange={e=>change(index,{price:e.target.value})}/></label>
   <button type="button" className={styles.remove} aria-label={`Remove ${item.name}`} disabled={items.length===1} onClick={()=>setItems(current=>current.filter((_,i)=>i!==index))}>Remove</button>
  </div>)}</div>
  <div className="button-row"><button type="button" onClick={()=>setItems(current=>[...current,{key:crypto.randomUUID(),service_id:String(items.find(item=>item.kind==="base_service")?.service_id||booking.service_id),kind:"upsell",name:"",quantity:1,price:""}])}>Add upgrade</button><label className="field"><span>Add another service</span><select value="" onChange={e=>{const service=services.find(s=>s.id===e.target.value);if(service)setItems(current=>[...current,{key:crypto.randomUUID(),service_id:String(service.id),kind:"base_service",name:String(service.name),quantity:1,price:service.pricing_mode==="quote"?"":String(Number(service.price_cents)/100)}]);}}><option value="">Choose service</option>{services.map(s=><option key={String(s.id)} value={String(s.id)}>{String(s.name)}</option>)}</select></label></div>
  <section className={styles.section}><div className={styles.sectionHeading}><h3>Discounts</h3><button type="button" onClick={()=>setDiscounts(current=>[...current,{kind:"fixed",value:"",reason:""}])}>Add discount</button></div>
  {discounts.length===0&&<p className="small-note">No discount. Employee percentages use each service’s price after discounts.</p>}
  {discounts.map((d,index)=><div className={styles.discount} key={index}><label className="field"><span>Type</span><select value={d.kind} onChange={e=>setDiscounts(current=>current.map((v,i)=>i===index?{...v,kind:e.target.value as Discount["kind"]}:v))}><option value="fixed">Dollar amount</option><option value="percent">Percentage</option></select></label><label className="field"><span>{d.kind==="percent"?"Discount (%)":"Discount ($)"}</span><input type="number" required min={0} max={d.kind==="percent"?100:undefined} step="0.01" value={d.value} onChange={e=>setDiscounts(current=>current.map((v,i)=>i===index?{...v,value:e.target.value}:v))}/></label><label className="field"><span>Reason</span><input required minLength={2} value={d.reason} onChange={e=>setDiscounts(current=>current.map((v,i)=>i===index?{...v,reason:e.target.value}:v))}/></label><button type="button" onClick={()=>setDiscounts(current=>current.filter((_,i)=>i!==index))}>Remove</button></div>)}
  </section>
  <div className={styles.pricingFooter}><label className="field"><span>Requested deposit ($)</span><input type="number" required min={0} step="0.01" value={deposit} onChange={e=>setDeposit(e.target.value)}/><small>Part of the service total, not an extra charge.</small></label><dl className={styles.breakdown}><div><dt>Services & upgrades</dt><dd>{money(gross)}</dd></div><div><dt>Discounts</dt><dd>−{money(discount)}</dd></div><div><dt>Agreed service total</dt><dd>{quoted?"Quote pending":money(total)}</dd></div></dl></div>
  {!!booking.square_invoice&&<p className="small-note">Changing the price closes the previous Square invoice for future payments. Payments already received stay recorded. Collect any remaining balance from Payments.</p>}
  {error&&<p role="alert" className="error-message">{error}</p>}
  <div className="button-row"><button className="button" disabled={busy}>{busy?"Saving prices…":"Save prices & discount"}</button></div>
 </form>;
}
