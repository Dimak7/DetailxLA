import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closeDatabase, query, transaction } from "../lib/platform/db";
import { enqueueBooking } from "../lib/platform/outbox";
import { settings } from "../lib/platform/settings";
import type { Booking, Service } from "../lib/platform/types";

Object.assign(process.env, {
  NODE_ENV: "test", PGLITE_PATH: "memory://telegram-booking-alerts",
  NEXT_PUBLIC_SITE_URL: "https://example.test", SQUARE_ENVIRONMENT: "production",
});
for (const key of ["DATABASE_URL", "RAILWAY_ENVIRONMENT", "ADMIN_EMAIL", "ADMIN_PASSWORD", "SQUARE_ACCESS_TOKEN", "TELEGRAM_BOT_TOKEN", "RESEND_API_KEY", "EMAIL_PROVIDER_API_KEY", "TWILIO_AUTH_TOKEN", "SMS_PROVIDER_AUTH_TOKEN", "META_ACCESS_TOKEN"])
  delete process.env[key];

type Alert = { subject: string; body: string; channel: string; dedupe_key: string };

test("Telegram request alerts use actual services and distinguish quote, deposit and confirmed bookings", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("This test must never deliver messages or charge payments."); });
  try {
    const business = { ...await settings(), telegram_chat_id: "fixture-chat", email: "shop@example.test" };
    const service = (await query<Service>("SELECT * FROM wl.services WHERE slug='maintenance-detail'"))[0];
    const customerId = randomUUID(), vehicleId = randomUUID();
    await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone) VALUES($1,'Booking','Fixture','booking-alert@example.test','+13125550123')", [customerId]);
    await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Test','Car',2026,'Sedan')", [vehicleId,customerId]);
    await query("UPDATE wl.email_templates SET subject='Custom appointment: {{customer_name}}',body='Custom introduction. Service: {{service_name}}. Estimate: {{total}}. {{admin_url}}' WHERE key='new_booking'");
    async function fixture(name: string, options: { price?: number | null; deposit?: number; status?: string; snapshotQuote?: boolean; lineQuote?: boolean } = {}) {
      const id = randomUUID();
      const snapshot = { ...service, requires_quote: options.snapshotQuote ?? false };
      const booking = (await query<Booking>(`INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,price_cents,deposit_cents,status)
        VALUES($1::uuid,$1::text,'fixture',$2,$3,$4,$5,$6,$7::jsonb,'2026-01-01',480,60,$8,$9,$10) RETURNING *`,
      [id, `TEST-${id}`, customerId, vehicleId, service.id, name, JSON.stringify(snapshot), options.price === undefined ? 2500 : options.price, options.deposit ?? 0, options.status ?? "new"]))[0];
      await query("INSERT INTO wl.booking_line_items(id,booking_id,service_id,kind,name,quantity,unit_price_cents,quote_pending) VALUES($1,$2,$3,'base_service',$4,1,$5,$6)", [randomUUID(),id,service.id,name,options.price ?? 2500,options.lineQuote ?? false]);
      return booking;
    }
    async function alert(booking: Booking, suffix = "") {
      await transaction(q => enqueueBooking(q, booking, business, "fixture-token", "booking_request", suffix));
      return (await query<Alert>("SELECT subject,body,channel,dedupe_key FROM wl.messages WHERE booking_id=$1 AND channel='telegram' AND dedupe_key=$2", [booking.id,`${booking.id}:booking_request:${suffix}:business:telegram`]))[0];
    }

    await t.test("unknown current price is a quote request with the selected Maintenance service", async () => {
      const booking = await fixture("Maintenance Detail", { price: null });
      const message = await alert(booking);
      assert.equal(message.subject, "Quote request: Booking Fixture");
      assert.match(message.body, /Service: Maintenance Detail/);
      assert.match(message.body, /Booking status: New/);
      assert.match(message.body, /Quote required: confirm the scope and agreed price/);
      assert.doesNotMatch(message.body, /Deposit due:|Remaining service balance:/);
    });
    await t.test("an unresolved line still needs a quote even with a numeric booking price", async () => {
      const message = await alert(await fixture("Paint Correction", { price: 52500, lineQuote: true }));
      assert.equal(message.subject, "Quote request: Booking Fixture");
      assert.match(message.body, /Service: Paint Correction/);
    });
    await t.test("custom job name and agreed price override a stale quote snapshot; email template stays unchanged", async () => {
      const booking = await fixture("Hand wash", { price: 2500, status: "confirmed", snapshotQuote: true });
      const message = await alert(booking);
      assert.equal(message.subject, "Confirmed appointment: Booking Fixture");
      assert.match(message.body, /Custom introduction\. Service: Hand wash/);
      assert.match(message.body, /Booking status: Confirmed/);
      assert.match(message.body, /Agreed service total: \$25/);
      assert.doesNotMatch(message.body, /Quote required|Maintenance Detail/);
      const email = (await query<Alert>("SELECT subject,body FROM wl.messages WHERE dedupe_key=$1", [`${booking.id}:booking_request::business:email`]))[0];
      assert.equal(email.subject, "Custom appointment: Booking Fixture");
      assert.match(email.body, /Custom introduction\. Service: Hand wash/);
      assert.doesNotMatch(email.body, /Booking status:|Agreed service total:/);
    });
    await t.test("multiple service names are retained and deposit due excludes pending and other-environment payments", async () => {
      const booking = await fixture("Full Detail + Ceramic Coating", { price: 55000, deposit: 27500 });
      for (const payment of [
        { provider: "square", environment: "production", status: "partially_refunded", amount: 5000, refunded: 1000 },
        { provider: "manual", environment: "", status: "paid", amount: 1000, refunded: 0 },
        { provider: "square", environment: "sandbox", status: "paid", amount: 20000, refunded: 0 },
        { provider: "square", environment: "production", status: "pending", amount: 10000, refunded: 0 },
      ]) await query("INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,refunded_cents,provider,status,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)", [randomUUID(),booking.id,customerId,payment.amount,payment.refunded,payment.provider,payment.status,JSON.stringify({ square_environment: payment.environment })]);
      const message = await alert(booking);
      assert.equal(message.subject, "Booking request · deposit due: Booking Fixture");
      assert.match(message.body, /Service: Full Detail \+ Ceramic Coating/);
      assert.match(message.body, /Deposit due: \$225/);
      assert.match(message.body, /Remaining service balance: \$500/);
    });
    await t.test("no-deposit requests are not called confirmed and repeat queueing does not rewrite past alerts", async () => {
      const booking = await fixture("Exterior Detail");
      const original = await alert(booking);
      assert.equal(original.subject, "Booking request: Booking Fixture");
      assert.match(original.body, /No deposit required; confirmation is pending/);
      const duplicate = await alert({ ...booking, service_name: "Changed later", status: "confirmed" });
      assert.deepEqual(duplicate, original);
      assert.equal((await query("SELECT id FROM wl.messages WHERE booking_id=$1 AND channel='telegram'", [booking.id])).length, 1);
    });
    await t.test("a paid deposit does not itself falsely claim that a new appointment is confirmed", async () => {
      const booking = await fixture("Interior Detail", { price: 20000, deposit: 10000 });
      await query("INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,provider,status) VALUES($1,$2,$3,10000,'manual','paid')", [randomUUID(),booking.id,customerId]);
      const message = await alert(booking);
      assert.equal(message.subject, "Booking request: Booking Fixture");
      assert.match(message.body, /Deposit received; confirmation is pending/);
      assert.doesNotMatch(message.body, /Deposit due:/);
    });
    await t.test("other statuses remain explicit rather than being mislabeled confirmed", async () => {
      const message = await alert(await fixture("Full Detail", { status: "in_progress" }));
      assert.equal(message.subject, "Booking update: Booking Fixture");
      assert.match(message.body, /Booking status: In progress/);
    });
  } finally { await closeDatabase(); }
});
