import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { adminAction } from "../lib/platform/admin";
import { closeDatabase, database, query } from "../lib/platform/db";
import { jobFinancials } from "../lib/platform/job-financials";
import { bookingById } from "../lib/platform/bookings";
import { handleSquareEvent } from "../lib/integrations/payments";
import type { Session } from "../lib/platform/types";

process.env.PGLITE_PATH = "memory://dashboard-booking-actions";
Object.assign(process.env, { NODE_ENV: "test" });
delete process.env.DATABASE_URL;
delete process.env.RAILWAY_ENVIRONMENT;
process.env.ADMIN_SESSION_SECRET = "dashboard-test-only-session-secret-32-characters";

async function appointment(price = 10000) {
  const customer = randomUUID(), vehicle = randomUUID(), booking = randomUUID();
  await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone) VALUES($1,'Test','Customer',$2,'')", [customer, `${customer}@example.test`]);
  await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Test','Car',2026,'Sedan')", [vehicle, customer]);
  const service = (await query<{ id: string }>("SELECT id FROM wl.services LIMIT 1"))[0].id;
  await query(`INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,price_cents)
    VALUES($1::uuid,$1::text,'test',$1::text,$2,$3,$4,'Test detail','{}','2030-09-28',480,120,$5)`, [booking, customer, vehicle, service, price]);
  return booking;
}
async function snapshot(booking: string) {
  return {
    booking: (await query("SELECT price_cents FROM wl.bookings WHERE id=$1", [booking]))[0],
    items: await query("SELECT id,kind,quantity,unit_price_cents FROM wl.booking_line_items WHERE booking_id=$1 ORDER BY id", [booking]),
    discounts: await query("SELECT id,kind,value,amount_cents FROM wl.booking_discounts WHERE booking_id=$1 ORDER BY id", [booking]),
  };
}

test("dashboard financial booking actions enforce roles and invoice ownership", async (t) => {
  await database();
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network request"); });
  const owner: Session = { id: "owner-session", user_id: randomUUID(), name: "Owner", email: "owner@example.test", role: "owner" };
  const staff: Session = { ...owner, user_id: randomUUID(), role: "staff" };
  for (const user of [owner, staff]) await query("INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,$2,$3,'unused',$4)", [user.user_id, user.name, `${user.user_id}@example.test`, user.role]);
  const item = (booking_id: string) => ({ booking_id, kind: "upsell", name: "Paint care", quantity: 1, unit_price_cents: 1000 });
  const discount = (booking_id: string) => ({ booking_id, kind: "fixed", value: 500, reason: "Approved adjustment" });
  try {
    const protectedBooking = await appointment();
    const before = await snapshot(protectedBooking);
    await assert.rejects(adminAction("save_booking_line_item", item(protectedBooking), staff), /manager|pricing|cannot perform/i);
    await assert.rejects(adminAction("save_booking_discount", discount(protectedBooking), staff), /manager|pricing|cannot perform/i);
    assert.deepEqual(await snapshot(protectedBooking), before);
    assert.equal((await query("SELECT * FROM wl.audit_logs WHERE actor_id=$1", [staff.user_id])).length, 0);
    t.diagnostic("Staff cannot change pricing on unassigned or other detailers' appointments");

    const bookingA = await appointment(), bookingB = await appointment(20000);
    const line = await adminAction("save_booking_line_item", item(bookingA), owner) as { id: string };
    const adjustment = await adminAction("save_booking_discount", discount(bookingA), owner) as { id: string };
    const originalA = await snapshot(bookingA), originalB = await snapshot(bookingB);
    await assert.rejects(adminAction("save_booking_line_item", { ...item(bookingB), id: line.id, unit_price_cents: 9000 }, owner), /belong|appointment|booking/i);
    await assert.rejects(adminAction("save_booking_discount", { ...discount(bookingB), id: adjustment.id, value: 7000 }, owner), /belong|appointment|booking/i);
    assert.deepEqual(await snapshot(bookingA), originalA, "The original invoice and its lines must remain unchanged");
    assert.deepEqual(await snapshot(bookingB), originalB, "A rejected edit must not seed or change another invoice");
    t.diagnostic("Cross-booking line-item and discount IDs cannot corrupt either invoice");

    await assert.rejects(adminAction("save_booking_line_item", { ...item(bookingA), id: randomUUID() }, owner), /not found/i);
    await assert.rejects(adminAction("save_booking_discount", { ...discount(bookingA), id: randomUUID() }, owner), /not found/i);
    assert.deepEqual(await snapshot(bookingA), originalA);
    t.diagnostic("Missing edited rows report not found without creating phantom adjustments");

    await adminAction("save_booking_line_item", { ...item(bookingA), id: line.id, quantity: 2, unit_price_cents: 2000 }, owner);
    let totals = await jobFinancials(bookingA);
    assert.equal(totals?.gross_service_cents, 14000);
    assert.equal(totals?.net_service_cents, 13500);
    assert.equal(totals?.price_cents, 13500);
    await adminAction("save_booking_discount", { ...discount(bookingA), id: adjustment.id, value: 2000 }, owner);
    totals = await jobFinancials(bookingA);
    assert.equal(totals?.gross_service_cents, 14000);
    assert.equal(totals?.net_service_cents, 12000);
    assert.equal(totals?.price_cents, 12000);
    assert.equal(totals?.outstanding_cents, 12000);
    assert.deepEqual(await snapshot(bookingB), originalB);
    t.diagnostic("Authorized same-invoice edits recompute gross, discount, payable total, and outstanding balance");

    const repriced = await appointment();
    await adminAction("save_booking_line_item", item(repriced), owner);
    await adminAction("update_booking", { id: repriced, price_cents: 15000 }, owner);
    assert.equal((await jobFinancials(repriced))?.base_service_cents, 14000);
    await adminAction("save_booking_line_item", { ...item(repriced), unit_price_cents: 500 }, owner);
    assert.equal((await bookingById(repriced)).price_cents, 15500, "A later upsell must preserve the edited agreement");
    await adminAction("save_booking_discount", discount(repriced), owner);
    await adminAction("update_booking", { id: repriced, price_cents: 18000 }, owner);
    await adminAction("save_booking_line_item", { ...item(repriced), unit_price_cents: 200 }, owner);
    totals = await jobFinancials(repriced);
    assert.equal(totals?.price_cents, 18200);
    assert.equal(totals?.net_service_cents, 18200);
    assert.equal(totals?.discount_cents, 500, "Existing discount amounts retain their recorded value");
    const repricedBefore = await snapshot(repriced);
    await assert.rejects(adminAction("update_booking", { id: repriced, price_cents: 0 }, owner), /negative.*upsells or discounts/i);
    await assert.rejects(adminAction("update_booking", { id: repriced, price_cents: null }, owner), /agreed service price/i);
    assert.deepEqual(await snapshot(repriced), repricedBefore);
    assert.equal((await query("SELECT * FROM wl.audit_logs WHERE entity_id=$1 AND action='agreed_price_updated'", [repriced])).length, 2);
    assert.equal((await query("SELECT * FROM wl.messages WHERE booking_id=$1", [repriced])).length, 0);
    t.diagnostic("Agreed total edits survive later adjustments, preserve discount snapshots, and reject invalid bases atomically");

    const discounted = await appointment();
    await adminAction("save_booking_discount", { ...discount(discounted), value: 15000 }, owner);
    const discountedBefore = await snapshot(discounted);
    await adminAction("update_booking", { id: discounted, status: "in_progress", price_cents: 0, internal_notes: "Work started" }, owner);
    assert.deepEqual(await snapshot(discounted), discountedBefore, "An unchanged total submitted with a status edit cannot consume an excess discount");
    assert.equal((await bookingById(discounted)).status, "in_progress");
    assert.equal((await query("SELECT * FROM wl.audit_logs WHERE entity_id=$1 AND action='agreed_price_updated'", [discounted])).length, 0);
    await adminAction("save_booking_line_item", { ...item(discounted), unit_price_cents: 100 }, owner);
    totals = await jobFinancials(discounted);
    assert.equal(totals?.base_service_cents, 10000);
    assert.equal(totals?.discount_cents, 15000);
    assert.equal(totals?.price_cents, 0);
    assert.equal(totals?.outstanding_cents, 0);
    t.diagnostic("Unchanged-price status saves preserve excess discounts and later upsell balances");

    process.env.SQUARE_ENVIRONMENT = "sandbox";
    const receipt = await appointment();
    const receiptCustomer = (await query<{ customer_id: string }>("SELECT customer_id FROM wl.bookings WHERE id=$1", [receipt]))[0].customer_id;
    for (const [provider, environment, amount, refunded] of [
      ["square", "sandbox", 3000, 500], ["square", "production", 4000, 0],
      ["square", "", 1000, 0], ["manual", "", 2000, 0], ["stripe", "", 500, 0],
    ] as const) {
      await query("INSERT INTO wl.payments(id,booking_id,customer_id,provider,amount_cents,refunded_cents,status,metadata) VALUES($1,$2,$3,$4,$5,$6,'paid',$7::jsonb)",
        [randomUUID(), receipt, receiptCustomer, provider, amount, refunded, JSON.stringify(environment ? { square_environment: environment } : {})]);
    }
    assert.equal(Number((await bookingById(receipt)).paid_cents), 5000);
    process.env.SQUARE_ENVIRONMENT = "production";
    assert.equal(Number((await bookingById(receipt)).paid_cents), 6500);
    process.env.SQUARE_ENVIRONMENT = "sandbox";
    t.diagnostic("Receipt payment totals match active Square checkout environment and retain non-Square credits");

    for (const bookingStatus of ["cancelled", "no_show", "new"] as const) {
      const target = await appointment();
      const customer = (await query<{ customer_id: string }>("SELECT customer_id FROM wl.bookings WHERE id=$1", [target]))[0].customer_id;
      const paymentId = randomUUID(), orderId = `late-${bookingStatus}`, externalId = `captured-${bookingStatus}`;
      await query("UPDATE wl.bookings SET status=$2 WHERE id=$1", [target, bookingStatus]);
      await query("INSERT INTO wl.payments(id,booking_id,customer_id,provider,amount_cents,metadata) VALUES($1,$2,$3,'square',10000,$4::jsonb)",
        [paymentId, target, customer, JSON.stringify({ square_environment: "sandbox", square_order_id: orderId })]);
      if (bookingStatus !== "new") await query("INSERT INTO wl.messages(id,dedupe_key,channel,recipient,body,booking_id,purpose) VALUES($1,$2,'email','test@example.test','Old reminder',$3,'reminder')", [randomUUID(), `old-reminder-${target}`, target]);
      const captured = { event_id: `capture-${target}`, type: "payment.updated", data: { object: { payment: {
        id: externalId, order_id: orderId, status: "COMPLETED", amount_money: { amount: 10000, currency: "USD" },
        created_at: "2026-09-28T10:00:00Z", updated_at: "2026-09-28T10:00:00Z",
      } } } };
      await handleSquareEvent(captured);
      await handleSquareEvent(captured);
      assert.equal((await query<{ status: string }>("SELECT status FROM wl.payments WHERE id=$1", [paymentId]))[0].status, "paid");
      assert.equal((await query<{ status: string }>("SELECT status FROM wl.square_payments WHERE environment='sandbox' AND payment_id=$1", [externalId]))[0].status, "COMPLETED");
      assert.equal((await query("SELECT id FROM wl.events WHERE id=$1", [`payment:${paymentId}`])).length, 1);
      assert.equal((await query("SELECT id FROM wl.timeline WHERE booking_id=$1 AND type='payment_received'", [target])).length, 1);
      const messages = await query<{ dedupe_key: string; purpose: string; status: string }>("SELECT dedupe_key,purpose,status FROM wl.messages WHERE booking_id=$1", [target]);
      const confirmations = messages.filter((message) => message.dedupe_key.includes(":booking_confirmation:"));
      if (bookingStatus === "new") {
        assert.equal((await bookingById(target)).status, "confirmed");
        assert.equal(confirmations.length, 2);
      } else {
        assert.equal((await bookingById(target)).status, bookingStatus);
        assert.equal(confirmations.length, 0);
        assert.ok(messages.filter((message) => message.purpose === "reminder").every((message) => message.status === "cancelled"));
      }
    }
    t.diagnostic("Late cancelled/no-show payments remain recorded without attendance messages; ordinary payments still confirm once");
  } finally {
    await closeDatabase();
  }
});
