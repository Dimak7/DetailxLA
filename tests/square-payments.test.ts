import assert from "node:assert/strict";
import test from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import { closeDatabase, database, query, transaction } from "../lib/platform/db";
import { createCheckout, handleSquareEvent, verifySquareEvent, type SquareEvent } from "../lib/integrations/payments";
import { normalizeSquarePayment, squareRevenueStatus, syncSquarePayments, upsertSquarePayment, type SquarePayment } from "../lib/integrations/square-reporting";

process.env.PGLITE_PATH = "memory://";
delete process.env.DATABASE_URL;
process.env.ADMIN_SESSION_SECRET = "square-test-only-session-secret-32-characters";
process.env.SQUARE_ACCESS_TOKEN = "square-test-only-token";
process.env.SQUARE_LOCATION_ID = "square-test-only-location";
process.env.SQUARE_ENVIRONMENT = "production";
process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = "square-test-only-signature";
process.env.SQUARE_WEBHOOK_URL = "https://example.test/api/webhooks/square";

const stamp = "2026-09-01T12:00:00.000Z";
function payment(id: string, extra: Partial<SquarePayment> = {}): SquarePayment {
  return { id, location_id: "location-a", status: "COMPLETED", amount_money: { amount: 10000, currency: "USD" },
    total_money: { amount: 11000, currency: "USD" }, tip_money: { amount: 1000, currency: "USD" },
    created_at: stamp, updated_at: stamp, source_type: "CASH", ...extra };
}
function event(id: string, value: SquarePayment): SquareEvent {
  return { event_id: id, type: "payment.updated", data: { object: { payment: value } } };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
async function ledger(id: string, environment = "production") {
  return (await query<Record<string, unknown>>("SELECT * FROM wl.square_payments WHERE payment_id=$1 AND environment=$2", [id, environment]))[0];
}
async function resetSync() { await query("DELETE FROM wl.square_sync"); }
async function localInvoice(orderId: string) {
  const customer = randomUUID(), vehicle = randomUUID(), booking = randomUUID(), id = randomUUID();
  await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone) VALUES($1,'Test','Customer',$2,'')", [customer, `${customer}@example.test`]);
  await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Test','Car',2026,'sedan')", [vehicle, customer]);
  const service = (await query<{ id: string }>("SELECT id FROM wl.services LIMIT 1"))[0].id;
  await query(`INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,price_cents)
    VALUES($1::uuid,$1::text,'test',$1::text,$2,$3,$4,'Test detail','{}','2026-09-28',480,120,10000)`, [booking, customer, vehicle, service]);
  await query("INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,provider,metadata) VALUES($1,$2,$3,10000,'square',$4::jsonb)", [id, booking, customer, JSON.stringify({ square_order_id: orderId })]);
  return { id, booking };
}

test("Square canonical ingestion and bounded sync", async (t) => {
  await database();
  // PGlite's WASM callback lifetime must remain in the initializing test context.
  const check = async (name: string, run: () => void | Promise<void>) => {
    await run();
    t.diagnostic(name);
  };
  // No test can reach a live Square API, even if the host has credentials.
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network request"); });
  try {
    await check("normalizes tips, signed fee adjustments and capture/offline timestamps", () => {
      const p = normalizeSquarePayment(payment("normalize", { total_money: undefined,
        processing_fee: [{ amount_money: { amount: 200, currency: "USD" } }, { amount_money: { amount: -250, currency: "USD" } }],
        card_details: { card_payment_timeline: { captured_at: "2026-09-02T10:00:00Z" } } }), "production");
      assert.equal(p.amount_cents, 11000);
      assert.equal(p.processor_fee_cents, -50);
      assert.equal(p.paid_at, "2026-09-02T10:00:00.000Z");
      assert.equal(normalizeSquarePayment(payment("offline", { offline_payment_details: { client_created_at: "2026-08-31T10:00:00Z" } }), "production").paid_at, "2026-08-31T10:00:00.000Z");
      assert.throws(() => normalizeSquarePayment(payment("unsafe", { total_money: { amount: Number.MAX_SAFE_INTEGER + 1, currency: "USD" } }), "production"), /invalid payment amount/);
    });

    await check("signed POS payment without order/booking counts once across repeated events", async () => {
      const body = JSON.stringify(event("pos-event", payment("pos")));
      const signature = createHmac("sha256", process.env.SQUARE_WEBHOOK_SIGNATURE_KEY!).update(process.env.SQUARE_WEBHOOK_URL + body).digest("base64");
      await assert.rejects(verifySquareEvent(body, "bad"), /signature/);
      const verified = await verifySquareEvent(body, signature);
      await handleSquareEvent(verified);
      await handleSquareEvent(verified);
      await handleSquareEvent(event("pos-another-event", payment("pos")));
      assert.equal((await query("SELECT * FROM wl.square_payments WHERE payment_id='pos'")).length, 1);
      assert.equal(Number((await ledger("pos")).amount_cents), 11000);
      assert.equal((await query("SELECT * FROM wl.bookings")).length, 0);
      assert.equal((await query("SELECT * FROM wl.customers")).length, 0);
    });

    await check("older and undated events cannot roll completed payments or cumulative refunds backward", async () => {
      await handleSquareEvent(event("new-refund-snapshot", payment("ordered", { refunded_money: { amount: 3000, currency: "USD" }, updated_at: "2026-09-03T12:00:00Z" })));
      await handleSquareEvent(event("old-approved", payment("ordered", { status: "APPROVED", total_money: { amount: 500, currency: "USD" }, updated_at: "2026-09-02T12:00:00Z" })));
      await handleSquareEvent(event("undated", payment("ordered", { status: "PENDING", updated_at: undefined })));
      const row = await ledger("ordered");
      assert.equal(row.status, "COMPLETED");
      assert.equal(Number(row.amount_cents), 11000);
      assert.equal(Number(row.refunded_cents), 3000);
    });

    await check("refund event IDs refresh one cumulative refund instead of adding it again", async () => {
      fetchMock.mock.mockImplementation(async (input, init) => {
        assert.equal(String(input), "https://connect.squareup.com/v2/payments/pos");
        assert.equal(init?.method, "GET");
        assert.ok(init?.signal);
        return json({ payment: payment("pos", { refunded_money: { amount: 2500, currency: "USD" }, updated_at: "2026-09-04T12:00:00Z" }) });
      });
      const refund = (id: string): SquareEvent => ({ event_id: id, type: "refund.updated", data: { object: { refund: { id: "same-refund", payment_id: "pos", status: "COMPLETED", amount_money: { amount: 2500, currency: "USD" } } } } });
      await handleSquareEvent(refund("refund-created"));
      await handleSquareEvent(refund("refund-updated"));
      await handleSquareEvent(refund("refund-updated"));
      assert.equal(Number((await ledger("pos")).refunded_cents), 2500);
      assert.equal(Number((await ledger("pos")).amount_cents), 11000);
    });

    await check("failed refresh does not consume webhook and can be retried safely", async () => {
      const refund: SquareEvent = { event_id: "retry-refund", type: "refund.updated", data: { object: { refund: { payment_id: "retry-payment", status: "COMPLETED" } } } };
      fetchMock.mock.mockImplementation(async () => json({ errors: [{ detail: "secret-token-must-not-escape" }] }, 403));
      await assert.rejects(handleSquareEvent(refund), (error: Error) => /access was denied/.test(error.message) && !error.message.includes("secret-token"));
      assert.equal((await query("SELECT * FROM wl.webhooks WHERE id LIKE '%retry-refund'")).length, 0);
      fetchMock.mock.mockImplementation(async () => json({ payment: payment("retry-payment", { refunded_money: { amount: 11000, currency: "USD" } }) }));
      await handleSquareEvent(refund);
      assert.equal(Number((await ledger("retry-payment")).refunded_cents), 11000);
    });

    await check("production and sandbox IDs/events stay independent", async () => {
      process.env.SQUARE_ENVIRONMENT = "sandbox";
      await handleSquareEvent(event("pos-event", payment("pos", { total_money: { amount: 9000, currency: "USD" } })));
      assert.equal(Number((await ledger("pos", "sandbox")).amount_cents), 9000);
      assert.equal(Number((await ledger("pos")).amount_cents), 11000);
      assert.equal((await squareRevenueStatus()).environment, "sandbox");
      process.env.SQUARE_ENVIRONMENT = "production";
    });

    await check("unique website invoice keeps confirmation behavior and mirrors refunds without negative-fee failure", async () => {
      const invoice = await localInvoice("website-order");
      const snapshot = payment("website-payment", { order_id: "website-order", processing_fee: [{ amount_money: { amount: -20, currency: "USD" } }] });
      await handleSquareEvent(event("website-payment-event", snapshot));
      const local = (await query<{ status: string; metadata: { square_environment: string }; processor_fee_cents: number }>("SELECT * FROM wl.payments WHERE id=$1", [invoice.id]))[0];
      assert.equal(local.status, "paid");
      assert.equal(local.metadata.square_environment, "production");
      assert.equal(local.processor_fee_cents, 0);
      assert.equal(Number((await ledger("website-payment")).processor_fee_cents), -20);
      assert.equal((await query<{ status: string }>("SELECT status FROM wl.bookings WHERE id=$1", [invoice.booking]))[0].status, "confirmed");
      const messages = (await query("SELECT * FROM wl.messages")).length;
      await transaction((q) => upsertSquarePayment(q, { ...snapshot, refunded_money: { amount: 4000, currency: "USD" }, updated_at: "2026-09-05T00:00:00Z" }, "production"));
      await transaction((q) => upsertSquarePayment(q, { ...snapshot, refunded_money: { amount: 4000, currency: "USD" }, updated_at: "2026-09-05T00:00:00Z" }, "production"));
      assert.equal(Number((await query<{ refunded_cents: number }>("SELECT refunded_cents FROM wl.payments WHERE id=$1", [invoice.id]))[0].refunded_cents), 4000);
      assert.equal((await query("SELECT * FROM wl.messages")).length, messages, "historical sync cannot send confirmations");
    });

    await check("bounded batches resume every page and inactive location without silent truncation", async () => {
      await resetSync();
      const urls: URL[] = [];
      fetchMock.mock.mockImplementation(async (input, init) => {
        const url = new URL(String(input)); urls.push(url);
        assert.equal(init?.method, "GET");
        if (url.pathname === "/v2/locations") return json({ locations: [{ id: "a", status: "ACTIVE" }, { id: "b", status: "INACTIVE" }] });
        assert.equal(url.searchParams.get("begin_time"), "1970-01-01T00:00:00Z");
        assert.equal(url.searchParams.get("sort_field"), "UPDATED_AT");
        assert.equal(url.searchParams.get("updated_at_begin_time"), null);
        if (url.searchParams.get("location_id") === "b") return json({ payments: [payment("b1", { location_id: "b" })] });
        return url.searchParams.get("cursor") === "next-a"
          ? json({ payments: [payment("a2", { location_id: "a" })] })
          : json({ payments: [payment("a1", { location_id: "a" })], cursor: "next-a" });
      });
      const first = await syncSquarePayments({ maxPages: 1 });
      assert.equal(first.complete, false); assert.equal(first.hasMore, true); assert.equal(first.processed, 1);
      const resume = (await query<{ cursor: { endTime: string } }>("SELECT cursor FROM wl.square_sync WHERE environment='production'"))[0].cursor;
      assert.equal((await squareRevenueStatus()).hasMore, true);
      const second = await syncSquarePayments({ maxPages: 1 });
      assert.equal(second.hasMore, true); assert.equal(second.processed, 1);
      const third = await syncSquarePayments({ maxPages: 1 });
      assert.equal(third.complete, true); assert.equal(third.hasMore, false);
      assert.equal(urls.filter((url) => url.pathname === "/v2/locations").length, 1);
      const paymentUrls = urls.filter((url) => url.pathname === "/v2/payments");
      assert.deepEqual(paymentUrls.map((url) => url.searchParams.get("location_id")), ["a", "a", "b"]);
      assert.ok(paymentUrls.every((url) => url.searchParams.get("end_time") === resume.endTime));
      assert.equal((await squareRevenueStatus()).lastSyncedAt, resume.endTime, "the watermark is the snapshot cutoff, not the later completion time");
      assert.equal((await query("SELECT * FROM wl.square_payments WHERE payment_id IN ('a1','a2','b1')")).length, 3);
    });

    await check("later sync overlaps updates but fully backfills a newly discovered location", async () => {
      const previous = (await squareRevenueStatus()).lastSyncedAt!;
      const seen: URL[] = [];
      fetchMock.mock.mockImplementation(async (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/v2/locations") return json({ locations: [{ id: "a" }, { id: "b" }, { id: "new" }] });
        seen.push(url);
        return json({ payments: url.searchParams.get("location_id") === "new" ? [payment("new-old-payment", { created_at: "2018-01-01T00:00:00Z", location_id: "new" })] : [] });
      });
      assert.equal((await syncSquarePayments()).complete, true);
      assert.equal(seen[0].searchParams.get("updated_at_begin_time"), new Date(new Date(previous).getTime() - 48 * 3600000).toISOString());
      assert.equal(seen[2].searchParams.get("updated_at_begin_time"), null);
      assert.ok(await ledger("new-old-payment"));
    });

    await check("HTTP failure preserves resumable cursor and sanitized error", async () => {
      await resetSync();
      fetchMock.mock.mockImplementation(async (input) => new URL(String(input)).pathname === "/v2/locations" ? json({ locations: [{ id: "a" }] }) : json({ payments: [payment("resume-1")], cursor: "resume-cursor" }));
      await syncSquarePayments({ maxPages: 1 });
      fetchMock.mock.mockImplementation(async () => json({ errors: [{ detail: "never-display-this-secret" }] }, 500));
      await assert.rejects(syncSquarePayments(), /could not return payment data/);
      const status = await squareRevenueStatus();
      assert.equal(status.hasMore, true); assert.equal(status.status, "error");
      assert.ok(!status.lastError.includes("never-display"));
      fetchMock.mock.mockImplementation(async (input) => {
        assert.equal(new URL(String(input)).searchParams.get("cursor"), "resume-cursor");
        return json({ payments: [payment("resume-2")] });
      });
      assert.equal((await syncSquarePayments()).complete, true);
    });

    await check("sync recovers a missed website webhook without historical messages or unpaid balance", async () => {
      await resetSync();
      const invoice = await localInvoice("missed-webhook-order");
      const messages = (await query("SELECT * FROM wl.messages")).length;
      const snapshot = payment("missed-webhook-payment", { order_id: "missed-webhook-order", refunded_money: { amount: 3000, currency: "USD" } });
      fetchMock.mock.mockImplementation(async (input) => new URL(String(input)).pathname === "/v2/locations"
        ? json({ locations: [{ id: "location-a" }] }) : json({ payments: [snapshot] }));
      assert.equal((await syncSquarePayments()).complete, true);
      const local = (await query<{ status: string; external_id: string; refunded_cents: number; paid_at: Date }>("SELECT * FROM wl.payments WHERE id=$1", [invoice.id]))[0];
      assert.equal(local.status, "partially_refunded");
      assert.equal(local.external_id, "missed-webhook-payment");
      assert.equal(local.refunded_cents, 3000);
      assert.equal(new Date(local.paid_at).toISOString(), stamp);
      assert.equal((await query<{ status: string }>("SELECT status FROM wl.bookings WHERE id=$1", [invoice.booking]))[0].status, "confirmed");
      assert.equal((await query("SELECT * FROM wl.messages")).length, messages);
    });

    await check("a refund arriving before its payment webhook reconciles silently", async () => {
      const invoice = await localInvoice("refund-first-order");
      const messages = (await query("SELECT * FROM wl.messages")).length;
      fetchMock.mock.mockImplementation(async () => json({ payment: payment("refund-first-payment", {
        order_id: "refund-first-order", refunded_money: { amount: 11000, currency: "USD" },
      }) }));
      await handleSquareEvent({ event_id: "refund-first", type: "refund.updated", data: { object: { refund: {
        id: "refund-first-id", payment_id: "refund-first-payment", status: "COMPLETED",
      } } } });
      assert.equal((await query<{ status: string }>("SELECT status FROM wl.payments WHERE id=$1", [invoice.id]))[0].status, "refunded");
      assert.equal((await query("SELECT * FROM wl.messages")).length, messages, "an already refunded historical payment must not send payment-received messages");
    });

    await check("checkout credits only the current Square environment and preserves other payment credits", async () => {
      const charged: number[] = [];
      fetchMock.mock.mockImplementation(async (input, init) => {
        assert.equal(String(input), "https://connect.squareup.com/v2/online-checkout/payment-links");
        const body = JSON.parse(String(init?.body));
        charged.push(body.order.line_items[0].base_price_money.amount);
        return json({ payment_link: { id: `link-${charged.length}`, order_id: `order-${charged.length}`, url: `https://square.link/test-${charged.length}` } });
      });
      for (const environment of ["sandbox", "production"]) {
        const invoice = await localInvoice(`balance-${environment}`);
        await query(`UPDATE wl.payments SET amount_cents=4000,status='paid',
          metadata=metadata||jsonb_build_object('square_environment',$2::text) WHERE id=$1`, [invoice.id, environment]);
        await createCheckout(invoice.booking);
      }
      const manual = await localInvoice("balance-manual");
      await query("UPDATE wl.payments SET provider='manual',amount_cents=4000,status='paid' WHERE id=$1", [manual.id]);
      await createCheckout(manual.booking);
      assert.deepEqual(charged, [10000, 6000, 6000]);
    });

    await check("unclassified paid Square invoices block collection before any checkout request", async () => {
      const invoice = await localInvoice("balance-unclassified");
      await query("UPDATE wl.payments SET amount_cents=4000,status='paid' WHERE id=$1", [invoice.id]);
      const calls = fetchMock.mock.callCount();
      await assert.rejects(createCheckout(invoice.booking), /Sync Square payments before collecting this appointment balance\./);
      assert.equal(fetchMock.mock.callCount(), calls);
      assert.equal((await query("SELECT * FROM wl.payments WHERE booking_id=$1", [invoice.booking])).length, 1);
    });

    await check("sandbox pending checkout cannot be reused for a production balance", async () => {
      const invoice = await localInvoice("pending-sandbox");
      await query(`UPDATE wl.payments SET checkout_url='https://square.link/sandbox-only',
        metadata=metadata||'{"square_environment":"sandbox"}'::jsonb WHERE id=$1`, [invoice.id]);
      fetchMock.mock.mockImplementation(async () => json({ payment_link: {
        id: "production-link", order_id: "production-pending-order", url: "https://square.link/production-only",
      } }));
      assert.equal(await createCheckout(invoice.booking), "https://square.link/production-only");
    });

    await check("an active lease returns busy without issuing network requests", async () => {
      await query("UPDATE wl.square_sync SET status='syncing',updated_at=now(),cursor='{\"lease\":\"other-worker\"}' WHERE environment='production'");
      const calls = fetchMock.mock.callCount();
      const busy = await syncSquarePayments();
      assert.equal(busy.busy, true); assert.equal(busy.hasMore, true); assert.equal(busy.complete, false);
      assert.equal(fetchMock.mock.callCount(), calls);
    });
  } finally {
    await closeDatabase();
  }
});
