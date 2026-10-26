import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { query, transaction, closeDatabase } from "../lib/platform/db";
import { report } from "../lib/platform/reporting";
import { upsertSquarePayment } from "../lib/integrations/square-reporting";

Object.assign(process.env, { PGLITE_PATH: "memory://reporting-balances", NODE_ENV: "test", SQUARE_ENVIRONMENT: "production" });
delete process.env.DATABASE_URL;
delete process.env.RAILWAY_ENVIRONMENT;

test("dashboard receivables exclude tips and cap each refunded receipt at zero service credit", async () => {
  try {
    const service = (await query<{id:string}>("SELECT id FROM wl.services LIMIT 1"))[0].id;
    const makeJob = async () => {
      const booking = randomUUID(), customer = randomUUID(), vehicle = randomUUID();
      await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone) VALUES($1,'Balance','Fixture',$2,'')", [customer, `${customer}@example.test`]);
      await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Test','Car',2026,'Sedan')", [vehicle, customer]);
      await query(`INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,status,price_cents,tip_cents,completed_at)
        VALUES($1::uuid,$1::text,'fixture',$1::text,$2,$3,$4,'Detail','{}','2026-10-26',600,120,'completed',10000,7500,'2026-10-26T17:00:00Z')`, [booking, customer, vehicle, service]);
      return { booking, customer };
    };
    const summary = () => report(new URLSearchParams({ from: "2026-10-26", to: "2026-10-26" }));
    const cash = await makeJob();
    await query("INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,tip_cents,status,provider,kind,paid_at) VALUES($1,$2,$3,2500,7500,'paid','manual','balance','2026-10-26T17:00:00Z')", [randomUUID(), cash.booking, cash.customer]);
    let result = await summary();
    assert.equal(result.outstanding, 7500, "$25 service + $75 tip still leaves $75 of a $100 service unpaid");
    assert.equal(result.payments_collected, 10000, "collections continue including the cash tip");

    const square = await makeJob();
    const paymentId = "balance-fixture-square";
    await query("INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,tip_cents,status,provider,kind,external_id,metadata,paid_at) VALUES($1,$2,$3,2500,7500,'paid','square','balance',$4,'{\"square_environment\":\"production\"}','2026-10-26T17:00:00Z')", [randomUUID(), square.booking, square.customer, paymentId]);
    const evidence = { id:paymentId, location_id:"fixture-location", status:"COMPLETED", amount_money:{amount:2500,currency:"USD"}, tip_money:{amount:7500,currency:"USD"}, total_money:{amount:10000,currency:"USD"}, created_at:"2026-10-26T17:00:00Z", updated_at:"2026-10-26T17:00:00Z" };
    await transaction(q => upsertSquarePayment(q, evidence, "production"));
    result = await summary();
    assert.equal(result.outstanding, 15000, "Square and cash apply the same service-only balance rule");
    assert.equal(result.payments_collected, 20000);

    await transaction(q => upsertSquarePayment(q, { ...evidence, refunded_money:{amount:10000,currency:"USD"}, updated_at:"2026-10-26T18:00:00Z" }, "production"));
    await query("INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,status,provider,kind,paid_at) VALUES($1,$2,$3,5000,'paid','manual','balance','2026-10-26T19:00:00Z')", [randomUUID(), square.booking, square.customer]);
    result = await summary();
    assert.equal(result.outstanding, 12500, "a refunded tip cannot consume the replacement $50 service payment");
    assert.equal(result.payments_collected, 15000);
  } finally { await closeDatabase(); }
});
