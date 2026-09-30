import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { workAsyncStorage, type WorkStore } from "next/dist/server/app-render/work-async-storage.external";
import { POST } from "../app/api/booking/status/route";
import { database, query, closeDatabase, type Query } from "../lib/platform/db";
import { hash, receiptToken } from "../lib/platform/auth";
import type { BookingReceipt } from "../lib/platform/receipts";

process.env.PGLITE_PATH = "memory://booking-status";
Object.assign(process.env,{NODE_ENV:"test"});
delete process.env.DATABASE_URL;
delete process.env.RAILWAY_ENVIRONMENT;
process.env.ADMIN_SESSION_SECRET = "booking-status-test-secret-at-least-32-characters";
process.env.SQUARE_ENVIRONMENT = "sandbox";
process.env.SQUARE_ACCESS_TOKEN = "booking-status-fake-token";
process.env.SQUARE_LOCATION_ID = "STATUS_LOCATION";
process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = "booking-status-fake-signature";

test("receipt status authenticates private links, verifies payment without redirects and preserves receipts during provider failures", async (t) => {
  const db = await database();
  const originalQuery = db.query;
  let inScope = false, callbacks:Array<() => Promise<void>> = [];
  const store = {afterContext:{after(callback:() => Promise<void>) { callbacks.push(callback); }}} as unknown as WorkStore;
  t.mock.method(workAsyncStorage,"getStore",() => inScope ? store : undefined);
  const requests:string[] = [];
  let providerState:"pending"|"completed"|"unavailable" = "pending";
  const customer = randomUUID(),vehicle = randomUUID(),booking = randomUUID(),invoice = randomUUID(),message = randomUUID();
  t.mock.method(globalThis,"fetch",async (input:RequestInfo|URL,init?:RequestInit) => {
    assert.equal(init?.method,"GET","status checks must never charge or mutate Square");
    const url = new URL(String(input));
    assert.equal(url.origin,"https://connect.squareupsandbox.com");
    requests.push(url.pathname);
    if (providerState === "unavailable") return Response.json({errors:[{detail:"PRIVATE_PROVIDER_TOKEN_AND_ERROR"}]},{status:502});
    if (url.pathname === "/v2/orders/STATUS_ORDER") return Response.json({order:{
      id:"STATUS_ORDER",location_id:"STATUS_LOCATION",reference_id:invoice,
      state:providerState === "completed" ? "COMPLETED" : "OPEN",
      total_money:{amount:5000,currency:"USD"},
      tenders:providerState === "completed" ? [{payment_id:"STATUS_PAYMENT",amount_money:{amount:5000,currency:"USD"}}] : [],
    }});
    assert.equal(url.pathname,"/v2/payments/STATUS_PAYMENT");
    return Response.json({payment:{
      id:"STATUS_PAYMENT",order_id:"STATUS_ORDER",location_id:"STATUS_LOCATION",status:"COMPLETED",
      amount_money:{amount:5000,currency:"USD"},total_money:{amount:5000,currency:"USD"},source_type:"CARD",
      created_at:"2026-09-29T12:00:00Z",updated_at:"2026-09-29T12:01:00Z",
      card_details:{card_payment_timeline:{captured_at:"2026-09-29T12:01:00Z"}},
    }});
  });
  try {
    const service = (await query<{id:string}>("SELECT id FROM wl.services LIMIT 1"))[0].id;
    await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone) VALUES($1,'Private','Customer','receipt-status-private@example.test','+15555550222')",[customer]);
    await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Porsche','911',2025,'Sedan')",[vehicle,customer]);
    await query(`INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,
      service_name,service_snapshot,booking_date,start_minute,duration_minutes,status,price_cents,deposit_cents)
      VALUES($1::uuid,$1::text,'fixture','STATUS-FIXTURE',$2,$3,$4,'Full Detail',
      '{"pricing_mode":"fixed"}','2026-10-10',600,120,'new',20000,5000)`,[booking,customer,vehicle,service]);
    await query(`INSERT INTO wl.payments(id,booking_id,customer_id,provider,status,amount_cents,metadata)
      VALUES($1,$2,$3,'square','pending',5000,'{"square_environment":"sandbox","square_order_id":"STATUS_ORDER","square_location_id":"STATUS_LOCATION"}')`,[invoice,booking,customer]);
    await query("INSERT INTO wl.messages(id,dedupe_key,channel,recipient,body,status,locked_at) VALUES($1::uuid,$1::text,'email','unused@example.test','Fixture','sending',now()-interval '1 hour')",[message]);
    const token = await receiptToken(booking);
    db.query = (async (sql,params) => { inScope = false; return originalQuery(sql,params); }) as Query;
    const request = (body:unknown = {id:booking,token},origin = "https://example.test") => new Request("https://example.test/api/booking/status?payment=returned",{
      method:"POST",headers:{Origin:origin,"Content-Type":"application/json","X-Forwarded-For":"203.0.113.10"},
      body:typeof body === "string" ? body : JSON.stringify(body),
    });
    const run = async (input:Request) => {
      inScope = true; callbacks = [];
      const response = await POST(input);
      assert.equal(response.headers.get("Cache-Control"),"private, no-store");
      return {response,body:await response.json() as {ok:boolean;receipt?:BookingReceipt;verificationUnavailable?:boolean;error?:string},afterTasks:[...callbacks]};
    };
    const sentinel = async () => (await query<{status:string}>("SELECT status FROM wl.messages WHERE id=$1",[message]))[0].status;
    for (const [input,status] of [
      [request({id:booking,token:"f".repeat(64)}),403],
      [request({id:booking}),400],
      [request({id:"invalid",token}),400],
      [request("{bad"),400],
      [request({id:booking,token},"https://other.example"),403],
    ] as const) {
      const result = await run(input);
      assert.equal(result.response.status,status);
      assert.equal(result.body.receipt,undefined);
      for (const task of result.afterTasks) await task();
      assert.equal(await sentinel(),"sending");
    }
    assert.deepEqual(requests,[],"invalid private links must never query the provider");
    const unknown = randomUUID();
    const missing = await run(request({id:unknown,token:await receiptToken(unknown)}));
    assert.equal(missing.response.status,404);
    assert.equal(missing.body.receipt,undefined);
    assert.deepEqual(requests,[]);
    t.diagnostic("origin, malformed payload, receipt-token and missing-appointment checks return no private data or provider requests");

    const pending = await run(request({id:booking,token,paidCents:20000,status:"confirmed",payment:"success"}));
    assert.equal(pending.response.status,200);
    assert.equal(pending.body.receipt!.status,"new");
    assert.equal(pending.body.receipt!.paidCents,0);
    assert.equal(pending.body.receipt!.pendingPayment,true);
    assert.equal(pending.body.verificationUnavailable,undefined);
    assert.deepEqual(requests,["/v2/orders/STATUS_ORDER"]);
    for (const task of pending.afterTasks) await task();
    assert.equal(await sentinel(),"sending","no provider update means no outbox processing");
    t.diagnostic("checkout-return hints and client-supplied amounts cannot confirm payment");

    providerState = "unavailable";
    const unavailable = await run(request());
    assert.equal(unavailable.response.status,200);
    assert.equal(unavailable.body.verificationUnavailable,true);
    assert.deepEqual(unavailable.body.receipt,pending.body.receipt);
    const unavailableJSON = JSON.stringify(unavailable.body);
    for (const privateValue of ["PRIVATE_PROVIDER_TOKEN_AND_ERROR","booking-status-fake-token","receipt-status-private@example.test","+15555550222",token])
      assert.equal(unavailableJSON.includes(privateValue),false);
    for (const task of unavailable.afterTasks) await task();
    assert.equal(await sentinel(),"sending");
    t.diagnostic("provider failures preserve the last verified snapshot and never expose error details or secrets");

    providerState = "completed";
    const completed = await run(request());
    assert.equal(completed.response.status,200);
    assert.equal(completed.body.receipt!.status,"confirmed");
    assert.equal(completed.body.receipt!.paidCents,5000);
    assert.equal(completed.body.receipt!.depositCents,5000);
    assert.equal(completed.body.receipt!.refundedCents,0);
    assert.equal(completed.body.receipt!.pendingPayment,false);
    assert.equal(completed.body.receipt!.failedPayment,false);
    assert.deepEqual(completed.body.receipt!.payments,[{id:invoice,amount_cents:5000}]);
    assert.equal((await query<{count:number}>("SELECT count(*)::int count FROM wl.events WHERE id=$1",["payment:"+invoice]))[0].count,1);
    const messagesBefore = await query("SELECT id FROM wl.messages WHERE booking_id=$1 ORDER BY id",[booking]);
    assert.ok(messagesBefore.length > 0,"verification queues the standard confirmation through the existing payment path");
    assert.equal(await sentinel(),"sending","confirmation delivery waits until after the HTTP response");
    // Exercise the worker gate without delivering fixture messages or contacting a real provider.
    await query("UPDATE wl.messages SET status='cancelled' WHERE booking_id=$1 AND status='queued'",[booking]);
    for (const task of completed.afterTasks) await task();
    assert.equal(await sentinel(),"uncertain","a true payment update schedules the outbox");
    const requestCount = requests.length;
    const repeated = await run(request());
    assert.deepEqual(repeated.body.receipt,completed.body.receipt);
    assert.equal(requests.length,requestCount,"a verified invoice does not query Square again");
    assert.deepEqual(await query("SELECT id FROM wl.messages WHERE booking_id=$1 ORDER BY id",[booking]),messagesBefore);
    t.diagnostic("verified Square evidence confirms the booking once, updates the receipt and queues one standard confirmation");

    await query(`INSERT INTO wl.payments(id,booking_id,customer_id,provider,status,amount_cents,metadata,created_at)
      VALUES($1,$2,$3,'square','pending',15000,'{"square_environment":"sandbox"}',now()+interval '1 second')`,[randomUUID(),booking,customer]);
    const orphan = await run(request());
    assert.equal(orphan.response.status,200);
    assert.equal(orphan.body.receipt!.paidCents,5000);
    assert.equal(orphan.body.receipt!.pendingPayment,false,"failed checkout creation must leave the balance retry available");
    assert.equal(requests.length,requestCount,"unissued invoices cannot be verified at Square");
    t.diagnostic("an invoice prepared before a checkout error does not trap the receipt in pending verification");

    await query(`INSERT INTO wl.rate_limits(key,count,expires_at) VALUES($1,60,now()+interval '1 minute')
      ON CONFLICT(key) DO UPDATE SET count=60,expires_at=now()+interval '1 minute'`,[hash("booking-status:203.0.113.10")]);
    const limited = await run(request());
    assert.equal(limited.response.status,429);
    assert.equal(limited.body.receipt,undefined);
    assert.equal(requests.length,requestCount);
    for (const task of limited.afterTasks) await task();
    t.diagnostic("status refresh is rate limited before verification and every response is private/no-store");
  } finally {
    db.query = originalQuery;
    await closeDatabase();
  }
});
