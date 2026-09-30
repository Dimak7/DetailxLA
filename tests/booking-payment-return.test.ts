import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { closeDatabase, database, query, transaction } from "../lib/platform/db";
import { handleSquareEvent, reconcileSquareBookingPayment } from "../lib/integrations/payments";
import { upsertSquarePayment, type SquarePayment } from "../lib/integrations/square-reporting";

process.env.PGLITE_PATH = "memory://booking-payment-return";
Object.assign(process.env, { NODE_ENV: "test" });
delete process.env.DATABASE_URL;
delete process.env.RAILWAY_ENVIRONMENT;
process.env.ADMIN_SESSION_SECRET = "return-test-only-session-secret-32-characters";
process.env.SQUARE_ACCESS_TOKEN = "return-test-only-token";
process.env.SQUARE_LOCATION_ID = "return-test-location";
process.env.SQUARE_ENVIRONMENT = "production";

async function fixture(environment = "production") {
  const customer = randomUUID(), vehicle = randomUUID(), booking = randomUUID(), id = randomUUID();
  const order = "order-" + id, payment = "payment-" + id;
  await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone) VALUES($1,'Return','Test',$2,'')", [customer, `${customer}@example.test`]);
  await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Test','Car',2026,'sedan')", [vehicle, customer]);
  const service = (await query<{ id: string }>("SELECT id FROM wl.services LIMIT 1"))[0].id;
  await query(`INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,price_cents,deposit_cents)
    VALUES($1::uuid,$1::text,'test',$1::text,$2,$3,$4,'Test detail','{}','2026-10-28',480,120,20000,10000)`, [booking, customer, vehicle, service]);
  await query("INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,kind,provider,metadata) VALUES($1,$2,$3,10000,'deposit','square',$4::jsonb)",
    [id, booking, customer, JSON.stringify({ square_order_id: order, square_environment: environment, square_location_id: "return-test-location" })]);
  return { id, booking, order, payment, customer };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function evidence(f: Fixture, overrides: Partial<SquarePayment> = {}): SquarePayment {
  return { id: f.payment, order_id: f.order, location_id: "return-test-location", status: "COMPLETED",
    amount_money: { amount: 10000, currency: "USD" }, total_money: { amount: 11000, currency: "USD" }, tip_money: { amount: 1000, currency: "USD" },
    created_at: "2026-09-29T12:00:00Z", updated_at: "2026-09-29T12:00:00Z", ...overrides };
}
async function state(f: Fixture) {
  const invoice = (await query<{ status: string; refunded_cents: number }>("SELECT status,refunded_cents FROM wl.payments WHERE id=$1", [f.id]))[0];
  const booking = (await query<{ status: string }>("SELECT status FROM wl.bookings WHERE id=$1", [f.booking]))[0];
  const messages = (await query("SELECT id FROM wl.messages WHERE booking_id=$1", [f.booking])).length;
  const events = (await query("SELECT id FROM wl.events WHERE name='payment_completed' AND booking_id=$1", [f.booking])).length;
  const timeline = (await query("SELECT id FROM wl.timeline WHERE type='payment_received' AND booking_id=$1", [f.booking])).length;
  return { invoice, booking, messages, events, timeline };
}

test("Square checkout return verifies saved invoices without charging again", async (t) => {
  await database();
  const scenario = async (name: string, run: () => Promise<void>) => { await run(); t.diagnostic(name); };
  let serve: (url: URL) => Promise<Response> = async () => { throw Error("Unexpected network request"); };
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.method, "GET", "Status reconciliation must never create a charge or change Square data");
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal);
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer return-test-only-token");
    const url = new URL(String(input));
    assert.equal(url.origin, "https://connect.squareup.com");
    requests.push(url.pathname);
    return serve(url);
  });
  const respond = (f: Fixture, value = evidence(f), orderOverrides: Record<string, unknown> = {}) => {
    serve = async (url) => {
      if (url.pathname === `/v2/orders/${f.order}`)
        return Response.json({ order: { id: f.order, location_id: "return-test-location", reference_id: f.id, tenders: [{ payment_id: f.payment }], ...orderOverrides } });
      assert.equal(url.pathname, `/v2/payments/${f.payment}`);
      return Response.json({ payment: value });
    };
  };
  try {
    await scenario("delayed payment stays pending then completes without a webhook, with exactly one confirmation", async () => {
      const f = await fixture();
      respond(f, evidence(f, { status: "PENDING" }));
      assert.equal(await reconcileSquareBookingPayment(f.booking), false);
      assert.equal((await state(f)).booking.status, "new");
      assert.equal((await state(f)).messages, 0);
      respond(f, evidence(f, { updated_at: "2026-09-29T12:01:00Z" }));
      assert.equal(await reconcileSquareBookingPayment(f.booking), true);
      const completed = await state(f);
      assert.equal(completed.invoice.status, "paid");
      assert.equal(completed.booking.status, "confirmed");
      assert.ok(completed.messages > 0);
      assert.equal(completed.events, 1);
      assert.equal(completed.timeline, 1);
      const count = requests.length;
      assert.equal(await reconcileSquareBookingPayment(f.booking), false);
      assert.equal(requests.length, count, "A settled invoice needs no further Square request");
      await handleSquareEvent({ event_id: "late-" + f.id, type: "payment.updated", data: { object: { payment: evidence(f) } } });
      assert.deepEqual(await state(f), completed);
    });

    await scenario("concurrent return checks and a webhook cannot duplicate completion", async () => {
      const f = await fixture();
      let getCount = 0, release!: () => void;
      const ready = new Promise<void>((resolve) => { release = resolve; });
      respond(f);
      const ordinary = serve;
      serve = async (url) => {
        if (url.pathname.startsWith("/v2/payments/")) {
          getCount++;
          if (getCount === 2) release();
          await ready;
        }
        return ordinary(url);
      };
      const returns = Promise.all([reconcileSquareBookingPayment(f.booking), reconcileSquareBookingPayment(f.booking)]);
      await ready;
      await handleSquareEvent({ event_id: "racing-" + f.id, type: "payment.updated", data: { object: { payment: evidence(f) } } });
      await returns;
      const current = await state(f);
      assert.equal(current.invoice.status, "paid");
      assert.equal(current.timeline, 1);
      assert.equal(current.events, 1);
      const messageKeys = await query<{ dedupe_key: string }>("SELECT dedupe_key FROM wl.messages WHERE booking_id=$1", [f.booking]);
      assert.equal(messageKeys.length, new Set(messageKeys.map((row) => row.dedupe_key)).size);
    });

    await scenario("return checks only invoices from the configured environment and only stored order IDs", async () => {
      const f = await fixture("sandbox"), count = requests.length;
      assert.equal(await reconcileSquareBookingPayment(f.booking), false);
      assert.equal(await reconcileSquareBookingPayment(randomUUID()), false);
      assert.equal(requests.length, count);
      assert.equal((await state(f)).invoice.status, "pending");
    });

    await scenario("order, reference, location, payment ID and payment order mismatches cannot confirm", async () => {
      for (const [orderChanges, paymentChanges] of [
        [{ id: "foreign-order" }, {}],
        [{ reference_id: randomUUID() }, {}],
        [{ location_id: "foreign-location" }, {}],
        [{}, { id: "foreign-payment" }],
        [{}, { order_id: "foreign-order" }],
        [{}, { location_id: "foreign-location" }],
      ] as Array<[Record<string, unknown>, Partial<SquarePayment>]>) {
        const f = await fixture();
        respond(f, evidence(f, paymentChanges), orderChanges);
        await assert.rejects(reconcileSquareBookingPayment(f.booking), /could not be matched/);
        assert.equal((await state(f)).invoice.status, "pending");
        assert.equal((await state(f)).messages, 0);
      }
    });

    await scenario("wrong principal or currency cannot confirm an invoice", async () => {
      for (const value of [
        { total_money: { amount: 10001, currency: "USD" }, tip_money: { amount: 0, currency: "USD" } },
        { total_money: { amount: 10000, currency: "CAD" }, amount_money: { amount: 10000, currency: "CAD" }, tip_money: { amount: 0, currency: "CAD" } },
      ]) {
        const f = await fixture();
        respond(f, evidence(f, value));
        assert.equal(await reconcileSquareBookingPayment(f.booking), false);
        assert.equal((await state(f)).booking.status, "new");
        assert.equal((await state(f)).messages, 0);
      }
    });

    await scenario("no tender remains pending and provider errors never consume the attempt or expose response details", async () => {
      const f = await fixture();
      respond(f, evidence(f), { tenders: [] });
      assert.equal(await reconcileSquareBookingPayment(f.booking), false);
      serve = async () => Response.json({ errors: [{ detail: "private-provider-details" }] }, { status: 403 });
      await assert.rejects(reconcileSquareBookingPayment(f.booking), (error: Error) => /temporarily unavailable/.test(error.message) && !error.message.includes("private-provider"));
      serve = async () => { throw Error("private-network-details"); };
      await assert.rejects(reconcileSquareBookingPayment(f.booking), /temporarily unavailable/);
      assert.equal((await state(f)).invoice.status, "pending");
      respond(f);
      assert.equal(await reconcileSquareBookingPayment(f.booking), true);
    });

    await scenario("failed payment becomes retryable without confirming the booking", async () => {
      const f = await fixture();
      respond(f, evidence(f, { status: "FAILED" }));
      assert.equal(await reconcileSquareBookingPayment(f.booking), true);
      const current = await state(f);
      assert.equal(current.invoice.status, "failed");
      assert.equal(current.booking.status, "new");
      assert.equal(current.messages, 0);
    });

    await scenario("canonical refund evidence cannot become a fresh appointment confirmation", async () => {
      const f = await fixture();
      await transaction((q) => upsertSquarePayment(q, evidence(f, { refunded_money: { amount: 11000, currency: "USD" }, updated_at: "2026-09-29T13:00:00Z" }), "production"));
      respond(f); // An older read must not erase the canonical refund.
      assert.equal(await reconcileSquareBookingPayment(f.booking), true);
      const current = await state(f);
      assert.equal(current.invoice.status, "refunded");
      assert.equal(current.invoice.refunded_cents, 10000);
      assert.equal(current.booking.status, "new");
      assert.equal(current.messages, 0);
      assert.equal(current.timeline, 0);
    });

    await scenario("payment recorded after cancellation cannot reopen the appointment", async () => {
      const f = await fixture();
      await query("UPDATE wl.bookings SET status='cancelled' WHERE id=$1", [f.booking]);
      respond(f);
      assert.equal(await reconcileSquareBookingPayment(f.booking), true);
      const current = await state(f);
      assert.equal(current.invoice.status, "paid");
      assert.equal(current.booking.status, "cancelled");
      assert.equal((await query("SELECT id FROM wl.messages WHERE booking_id=$1 AND channel IN ('email','sms')", [f.booking])).length, 0);
    });
  } finally {
    await closeDatabase();
  }
});
