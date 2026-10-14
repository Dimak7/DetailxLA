import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { commissionAmounts, marketingCommissionRows, marketingCommissionAction } from "../lib/platform/marketing-commissions";
import { normalizeAttribution, saveAttribution } from "../lib/platform/attribution";
import { query, transaction, closeDatabase } from "../lib/platform/db";
import { createBooking } from "../lib/platform/bookings";
import type { Service } from "../lib/platform/types";

process.env.PGLITE_PATH = "memory://marketing-commission";
Object.assign(process.env,{NODE_ENV:"test", ADMIN_EMAIL:"commission-owner@example.test",ADMIN_PASSWORD:"test-only-commission-long-password"});
for (const key of ["DATABASE_URL","RAILWAY_ENVIRONMENT","TELEGRAM_BOT_TOKEN","SQUARE_ACCESS_TOKEN","STRIPE_SECRET_KEY"]) delete process.env[key];

test("commission policy excludes unfinished/unpaid/repeat jobs and caps at service subtotal", () => {
  const base = {id:"first",status:"completed",first_completed_id:"first",price_cents:40000,collected_cents:48000,refunded_cents:0,rate_bps:1000,approved_basis_cents:null,paid_cents:0};
  assert.equal(commissionAmounts(base).earned_cents,4000); // extra collection (e.g. tax) never earns commission
  assert.equal(commissionAmounts({...base,rate_bps:2500}).earned_cents,10000);
  assert.equal(commissionAmounts({...base,status:"confirmed"}).earned_cents,0);
  assert.equal(commissionAmounts({...base,collected_cents:20000}).state,"Awaiting full payment");
  assert.equal(commissionAmounts({...base,first_completed_id:"organic-first"}).earned_cents,0);
  assert.equal(commissionAmounts({...base,refunded_cents:10000}).earned_cents,3000);
  const afterPayment = commissionAmounts({...base,approved_basis_cents:40000,paid_cents:4000,refunded_cents:10000});
  assert.equal(afterPayment.due_cents,-1000); assert.equal(afterPayment.state,"Adjustment required");
  assert.equal(commissionAmounts({...base,price_cents:null}).can_approve,false);
  assert.equal(normalizeAttribution({source:"google",medium:"cpc",lead_stream:"business-google"}).lead_stream,"Business Google · 10%");
  assert.equal(normalizeAttribution({source:"meta",medium:"paid_social",lead_stream:"business-meta"}).lead_stream,"Business Meta · 10%");
  assert.equal(normalizeAttribution({lead_stream:"dima-google"}).lead_stream,"Dima Google · 25%");
  assert.equal(normalizeAttribution({lead_stream:"dima"}).lead_stream,"Dima Leads");
});

test("ledger preserves lead source, prevents duplicate payouts, and identifies repeat customers across phone formats", async () => {
  try {
    const service=(await query<Service>("SELECT * FROM wl.services WHERE slug='exterior-detail'"))[0];
    const owner=(await query<{id:string}>("SELECT id FROM wl.users WHERE email=$1",[process.env.ADMIN_EMAIL]))[0];
    const date = new Date(Date.now()+14*86400000); while(date.getUTCDay()===0) date.setUTCDate(date.getUTCDate()+1);
    const makeBooking = async (email:string,phone:string,offset:number,leadId?:string) => {
      const d=new Date(date);d.setUTCDate(d.getUTCDate()+offset);while(d.getUTCDay()===0)d.setUTCDate(d.getUTCDate()+1);
      return (await createBooking({request_key:randomUUID(),service_id:service.id,session_id:randomUUID(),attribution:{source:"google",medium:"cpc",lead_stream:"business-google"},first_name:"Test",last_name:"Commission",email,phone,make:"Test",model:"Car",year:2026,vehicle_type:"Sedan",date:d.toISOString().slice(0,10),start_minute:480,terms:true,...(leadId?{lead_id:leadId}:{})},true)).booking;
    };
    const aid = await transaction((q)=>saveAttribution(q,randomUUID(),{source:"Meta Ads",lead_stream:"business-meta"}));
    const leadId=randomUUID();await query("INSERT INTO wl.leads(id,name,email,phone,attribution_id) VALUES($1,'Meta lead','commission-first@example.test','+13125550123',$2)",[leadId,aid]);
    const first=await makeBooking("commission-first@example.test","+1 (312) 555-0123",0,leadId);
    assert.equal((await marketingCommissionRows()).find((r)=>r.id===first.id)?.lead_stream,"Business Meta · 10%");
    await assert.rejects(marketingCommissionAction(first.id,owner.id,"approve",""),/first completed/);
    await query("UPDATE wl.bookings SET status='completed',completed_at=now(),price_cents=40000 WHERE id=$1",[first.id]);
    const payId=randomUUID();await query("INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,provider,status,paid_at) VALUES($1,$2,$3,45000,'manual','paid',now())",[payId,first.id,first.customer_id]);
    await marketingCommissionAction(first.id,owner.id,"approve","");
    const results=await Promise.allSettled([marketingCommissionAction(first.id,owner.id,"record_paid","bank-ref-1"),marketingCommissionAction(first.id,owner.id,"record_paid","bank-ref-2")]);
    assert.equal(results.filter((r)=>r.status==="fulfilled").length,1);
    const paid=(await marketingCommissionRows()).find((r)=>r.id===first.id)!;
    assert.equal(paid.paid_cents,4000);assert.equal(paid.state,"Settled");
    await query("UPDATE wl.payments SET refunded_cents=10000,status='partially_refunded' WHERE id=$1",[payId]);
    assert.equal((await marketingCommissionRows()).find((r)=>r.id===first.id)!.due_cents,-1000);
    const repeat=await makeBooking("different-email@example.test","3125550123",2);
    await query("UPDATE wl.bookings SET status='completed',completed_at=now()+interval '1 hour' WHERE id=$1",[repeat.id]);
    assert.equal((await marketingCommissionRows()).find((r)=>r.id===repeat.id)!.state,"Repeat customer — no commission");
    assert.equal((await query("SELECT id FROM wl.marketing_commission_payouts WHERE booking_id=$1",[first.id])).length,1);
    assert.equal((await query("SELECT id FROM wl.timeline WHERE booking_id=$1 AND type='marketing_commission'",[first.id])).length,2);
  } finally {await closeDatabase();}
});
