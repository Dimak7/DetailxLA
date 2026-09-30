import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database, query, closeDatabase } from "../lib/platform/db";
import { bookingReceipt } from "../lib/platform/receipts";

process.env.PGLITE_PATH = "memory://receipts";
Object.assign(process.env,{NODE_ENV:"test"});
delete process.env.DATABASE_URL;
delete process.env.RAILWAY_ENVIRONMENT;
process.env.SQUARE_ENVIRONMENT = "production";
process.env.SQUARE_ACCESS_TOKEN = "receipt-test-token";
process.env.SQUARE_LOCATION_ID = "receipt-test-location";
process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = "receipt-test-signature";

test("private receipt snapshots use applicable verified invoices, retain truthful statuses and omit private customer data", async (t) => {
  await database();
  t.mock.method(globalThis,"fetch",async () => { throw new Error("A receipt snapshot must not make network requests"); });
  try {
    const customer = randomUUID(),vehicle = randomUUID(),booking = randomUUID();
    const service = (await query<{id:string}>("SELECT id FROM wl.services LIMIT 1"))[0].id;
    await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone,notes) VALUES($1,'Private','Customer','private-email@example.test','+15555550199','private-customer-note')",[customer]);
    await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type,license_plate,vin) VALUES($1,$2,'Porsche','911',2025,'Sedan','PRIVATE-PLATE','PRIVATE-VIN')",[vehicle,customer]);
    await query(`INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,
      service_name,service_snapshot,booking_date,start_minute,duration_minutes,status,price_cents,deposit_cents,location,notes,internal_notes)
      VALUES($1::uuid,$1::text,'private-hash','RECEIPT-FIXTURE',$2,$3,$4,'Full Detail',
      '{"pricing_mode":"fixed","slug":"full-detail","private":"private-snapshot-data"}',
      '2026-10-10',600,120,'confirmed',20000,5000,'Studio address','private-booking-note','private-internal-note')`,[booking,customer,vehicle,service]);
    const invoice = async (provider:string,status:string,amount:number,refunded:number,environment:string|undefined,created:string) => {
      const id = randomUUID();
      await query(`INSERT INTO wl.payments(id,booking_id,customer_id,provider,status,amount_cents,refunded_cents,metadata,created_at,checkout_url,external_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,'https://private.example/checkout',$10)`,
      [id,booking,customer,provider,status,amount,refunded,JSON.stringify({square_environment:environment,secret:"PRIVATE-PAYMENT-METADATA"}),created,`private-provider-${id}`]);
      return id;
    };
    const production = await invoice("square","partially_refunded",10000,2000,"production","2026-09-01T12:00:00Z");
    const refunded = await invoice("square","refunded",4000,4000,"production","2026-09-02T12:00:00Z");
    const stripe = await invoice("stripe","partially_refunded",2500,500,undefined,"2026-09-03T12:00:00Z");
    const manual = await invoice("manual","paid",1000,0,undefined,"2026-09-04T12:00:00Z");
    await invoice("square","failed",1000,0,"production","2026-09-05T12:00:00Z");
    const sandbox = await invoice("square","paid",50000,0,"sandbox","2026-10-01T12:00:00Z");
    await invoice("square","pending",20000,0,"sandbox","2026-10-02T12:00:00Z");
    await invoice("square","paid",60000,0,undefined,"2026-10-03T12:00:00Z");
    let receipt = (await bookingReceipt(booking))!;
    assert.equal(receipt.paidCents,11000);
    assert.equal(receipt.refundedCents,6500);
    assert.equal(receipt.failedPayment,true);
    assert.equal(receipt.pendingPayment,false);
    assert.equal(receipt.provider,"square");
    assert.equal(receipt.vehicle,"2025 Porsche 911");
    assert.equal(receipt.priceCents,20000);
    assert.equal(receipt.depositCents,5000);
    assert.equal(receipt.date,"2026-10-10");
    assert.equal(receipt.startMinute,600);
    assert.equal(receipt.location,"Studio address");
    assert.equal(receipt.quoteBased,false);
    assert.deepEqual(receipt.payments.map((row) => row.id).sort(),[production,stripe,manual].sort());
    assert.equal(receipt.payments.find((row) => row.id === production)!.amount_cents,10000);
    assert.equal(receipt.payments.some((row) => row.id === refunded || row.id === sandbox),false);
    assert.deepEqual(Object.keys(receipt).sort(),[
      "id","reference","status","serviceName","vehicle","date","startMinute","location","priceCents","depositCents",
      "paidCents","refundedCents","provider","payments","pendingPayment","pendingCheckoutUrl","failedPayment","quoteBased",
    ].sort());
    const serialized = JSON.stringify(receipt);
    for (const privateValue of [customer,vehicle,"private-email","+15555550199","private-customer-note","PRIVATE-PLATE","PRIVATE-VIN","private-hash","private-snapshot-data","private-booking-note","private-internal-note","PRIVATE-PAYMENT-METADATA","private-provider","private.example"])
      assert.equal(serialized.includes(privateValue),false,`${privateValue} is not receipt data`);
    assert.deepEqual(JSON.parse(serialized),receipt);
    t.diagnostic("net paid, cumulative refunds, conversions and flags are environment-scoped and contain no customer contact data");

    const newest = await invoice("square","paid",500,0,"production","2026-09-06T12:00:00Z");
    receipt = (await bookingReceipt(booking))!;
    assert.equal(receipt.failedPayment,false,"an older failed attempt must not override a later verified invoice");
    assert.equal(receipt.pendingPayment,false);
    assert.equal(receipt.paidCents,11500);
    await query("UPDATE wl.payments SET status='pending' WHERE id=$1",[newest]);
    receipt = (await bookingReceipt(booking))!;
    assert.equal(receipt.pendingPayment,true,"a pending balance is distinct from an already-paid deposit");
    assert.equal(receipt.failedPayment,false);
    assert.equal(receipt.paidCents,11000);
    await query("UPDATE wl.payments SET status='expired' WHERE id=$1",[newest]);
    assert.equal((await bookingReceipt(booking))!.failedPayment,true);
    await query("UPDATE wl.payments SET status='pending',checkout_url='' WHERE id=$1",[newest]);
    assert.equal((await bookingReceipt(booking))!.pendingPayment,false,"a prepared invoice without an issued checkout must allow retry");
    await query("UPDATE wl.payments SET metadata=metadata||'{\"square_order_id\":\"ISSUED_ORDER\"}'::jsonb WHERE id=$1",[newest]);
    assert.equal((await bookingReceipt(booking))!.pendingPayment,true,"a saved Square order is an issued checkout even without its URL");
    await query("UPDATE wl.payments SET metadata=metadata-'square_order_id',provider='stripe',stripe_session_id='ISSUED_SESSION' WHERE id=$1",[newest]);
    assert.equal((await bookingReceipt(booking))!.pendingPayment,true,"a saved Stripe session is an issued checkout");
    await query("UPDATE wl.payments SET provider='square',stripe_session_id=NULL WHERE id=$1",[newest]);
    t.diagnostic("only the latest applicable invoice determines pending and failed flags");

    process.env.SQUARE_ENVIRONMENT = "sandbox";
    receipt = (await bookingReceipt(booking))!;
    assert.equal(receipt.paidCents,53000);
    assert.equal(receipt.refundedCents,500);
    assert.equal(receipt.pendingPayment,true);
    assert.equal(receipt.failedPayment,false);
    assert.deepEqual(receipt.payments.map((row) => row.id).sort(),[sandbox,stripe,manual].sort());
    process.env.SQUARE_ENVIRONMENT = "production";

    await query("UPDATE wl.payments SET status='refunded',refunded_cents=amount_cents WHERE booking_id=$1",[booking]);
    await query("UPDATE wl.bookings SET status='cancelled' WHERE id=$1",[booking]);
    receipt = (await bookingReceipt(booking))!;
    assert.equal(receipt.status,"cancelled");
    assert.equal(receipt.paidCents,0);
    assert.equal(receipt.refundedCents,19000);
    assert.deepEqual(receipt.payments,[]);
    assert.equal(receipt.pendingPayment,false);
    assert.equal(receipt.failedPayment,false);
    for (const status of ["new","confirmed","in_progress","completed","no_show"])
      { await query("UPDATE wl.bookings SET status=$2 WHERE id=$1",[booking,status]); assert.equal((await bookingReceipt(booking))!.status,status); }
    await query("UPDATE wl.bookings SET price_cents=NULL,service_snapshot='{}' WHERE id=$1",[booking]);
    assert.equal((await bookingReceipt(booking))!.quoteBased,true);
    assert.equal((await bookingReceipt(booking))!.priceCents,null);
    await query("UPDATE wl.bookings SET price_cents=50000,service_snapshot='{\"slug\":\"ceramic-coating\"}' WHERE id=$1",[booking]);
    assert.equal((await bookingReceipt(booking))!.quoteBased,true);
    assert.equal(await bookingReceipt(randomUUID()),null);
    t.diagnostic("cancelled, completed, no-show and refunded records are returned without inventing a confirmed appointment");

    delete process.env.SQUARE_ACCESS_TOKEN;
    process.env.STRIPE_SECRET_KEY = "stripe-test-secret";
    process.env.STRIPE_WEBHOOK_SECRET = "stripe-test-webhook";
    assert.equal((await bookingReceipt(booking))!.provider,"stripe");
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    assert.equal((await bookingReceipt(booking))!.provider,null);
  } finally { await closeDatabase(); }
});

test("resume links expose only the exact current provider checkout for the remaining invoice target", async (t) => {
  await database();
  process.env.SQUARE_ENVIRONMENT = "production";
  try {
    const customer = randomUUID(),vehicle = randomUUID(),booking = randomUUID(),invoice = randomUUID(),paid = randomUUID();
    const service = (await query<{id:string}>("SELECT id FROM wl.services LIMIT 1"))[0].id;
    await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone) VALUES($1,'Resume','Customer','resume@example.test','')",[customer]);
    await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Test','Car',2025,'Sedan')",[vehicle,customer]);
    await query(`INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,
      service_name,service_snapshot,booking_date,start_minute,duration_minutes,price_cents,deposit_cents)
      VALUES($1::uuid,$1::text,'fixture','RESUME-FIXTURE',$2,$3,$4,'Detail','{}','2026-10-10',600,120,20000,5000)`,[booking,customer,vehicle,service]);
    const squareUrl = "https://square.link/u/exact-issued-checkout";
    await query(`INSERT INTO wl.payments(id,booking_id,customer_id,provider,status,kind,amount_cents,checkout_url,metadata,created_at)
      VALUES($1,$2,$3,'square','pending','balance',20000,$4,'{"square_environment":"production"}','2026-10-10T12:00:00Z')`,[invoice,booking,customer,squareUrl]);
    const resume = async () => (await bookingReceipt(booking))!.pendingCheckoutUrl;
    assert.equal(await resume(),squareUrl);
    await query("UPDATE wl.bookings SET price_cents=15000 WHERE id=$1",[booking]);
    assert.equal(await resume(),null,"a discount cannot resume the original higher price");
    await query("UPDATE wl.payments SET amount_cents=15000 WHERE id=$1",[invoice]);
    assert.equal(await resume(),squareUrl);
    await query("UPDATE wl.bookings SET price_cents=20000 WHERE id=$1",[booking]);
    await query(`INSERT INTO wl.payments(id,booking_id,customer_id,provider,status,kind,amount_cents,created_at)
      VALUES($1,$2,$3,'stripe','paid','deposit',5000,'2026-10-09T12:00:00Z')`,[paid,booking,customer]);
    assert.equal(await resume(),squareUrl,"balance checkout must exactly equal price minus prior verified payment");
    await query("UPDATE wl.payments SET kind='deposit',amount_cents=5000 WHERE id=$1",[invoice]);
    assert.equal(await resume(),null,"an already-covered deposit must not be collected twice");
    await query("UPDATE wl.bookings SET deposit_cents=10000 WHERE id=$1",[booking]);
    assert.equal(await resume(),squareUrl,"deposit checkout uses remaining deposit rather than remaining full price");
    await query("UPDATE wl.bookings SET price_cents=7000 WHERE id=$1",[booking]);
    assert.equal(await resume(),null,"an unchanged deposit cannot exceed the newly discounted remaining full price");
    await query("UPDATE wl.bookings SET price_cents=NULL WHERE id=$1",[booking]);
    assert.equal(await resume(),null);
    await query("UPDATE wl.bookings SET price_cents=20000 WHERE id=$1",[booking]);
    for (const status of ["cancelled","no_show"]) {
      await query("UPDATE wl.bookings SET status=$2 WHERE id=$1",[booking,status]);
      assert.equal(await resume(),null);
    }
    await query("UPDATE wl.bookings SET status='confirmed' WHERE id=$1",[booking]);
    await query("UPDATE wl.payments SET status='partially_refunded',refunded_cents=2000 WHERE id=$1",[paid]);
    await query("UPDATE wl.payments SET amount_cents=7000 WHERE id=$1",[invoice]);
    assert.equal(await resume(),null,"even an amount-matched checkout is withheld after any refund");
    await query("UPDATE wl.payments SET status='paid',refunded_cents=0 WHERE id=$1",[paid]);
    await query("UPDATE wl.payments SET amount_cents=5000 WHERE id=$1",[invoice]);
    t.diagnostic("resume amounts respect discounts, prior payments, invoice kind, refunds and terminal appointments");

    for (const unsafe of ["http://square.link/u/test","https://square.link.evil.example/u/test","https://evil.square.link/u/test",
      "https://user:secret@square.link/u/test","https://square.link:444/u/test","javascript:alert(1)","//square.link/u/test",
      " https://square.link/u/test","https://square.link\\@evil.example/u/test","https://checkout.stripe.com/c/pay/cs_test_wrong_provider"] ) {
      await query("UPDATE wl.payments SET checkout_url=$2 WHERE id=$1",[invoice,unsafe]);
      assert.equal(await resume(),null,unsafe);
    }
    await query("UPDATE wl.payments SET checkout_url=$2,metadata='{\"square_environment\":\"sandbox\"}' WHERE id=$1",[invoice,squareUrl]);
    assert.equal(await resume(),null,"other environment invoices never supply a resume URL");
    process.env.SQUARE_ENVIRONMENT = "sandbox";
    assert.equal(await resume(),null,"a sandbox invoice cannot resume a production Square URL");
    const sandboxUrl = "https://sandbox.square.link/u/exact-sandbox-checkout";
    await query("UPDATE wl.payments SET checkout_url=$2 WHERE id=$1",[invoice,sandboxUrl]);
    assert.equal(await resume(),sandboxUrl);
    const stripeUrl = "https://checkout.stripe.com/c/pay/cs_test_exact#session-fragment";
    await query("UPDATE wl.payments SET provider='stripe',checkout_url=$2 WHERE id=$1",[invoice,stripeUrl]);
    assert.equal(await resume(),stripeUrl,"the validated link is returned exactly, including the Stripe fragment");
    await query("UPDATE wl.payments SET provider='manual' WHERE id=$1",[invoice]);
    assert.equal(await resume(),null);
    await query("UPDATE wl.payments SET provider='stripe' WHERE id=$1",[invoice]);
    for (const status of ["failed","expired","paid","partially_refunded","refunded"]) {
      await query("UPDATE wl.payments SET status=$2 WHERE id=$1",[invoice,status]);
      assert.equal(await resume(),null,"only a pending invoice is resumable");
    }
    await query("UPDATE wl.payments SET status='pending',checkout_url='' WHERE id=$1",[invoice]);
    assert.equal(await resume(),null);
    assert.equal((await bookingReceipt(booking))!.pendingPayment,false);
    t.diagnostic("provider-specific HTTPS hosts, environment and pending status constrain exact checkout links");
  } finally { await closeDatabase(); }
});
