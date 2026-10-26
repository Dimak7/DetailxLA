import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { query, transaction, closeDatabase } from "../lib/platform/db";
import { prepareJobPriceChange, recordJobCashPayment, linkSquareJobPayment, listUnlinkedSquareJobPayments, refreshJobPayments } from "../lib/platform/job-payments";
import { createCheckout } from "../lib/integrations/payments";
import { upsertSquarePayment, type SquarePayment } from "../lib/integrations/square-reporting";
import type { Session } from "../lib/platform/types";

Object.assign(process.env, { PGLITE_PATH: "memory://job-payments", NODE_ENV: "test", SQUARE_ENVIRONMENT: "production", SQUARE_ACCESS_TOKEN: "test-token", SQUARE_LOCATION_ID: "test-location", SQUARE_WEBHOOK_SIGNATURE_KEY: "test-webhook", ADMIN_EMAIL: "job-payments@example.test", ADMIN_PASSWORD: "test-only-job-payment-pass-123" });
delete process.env.DATABASE_URL;
delete process.env.RAILWAY_ENVIRONMENT;

async function job(price: number, deposit = 0) {
  const customer = randomUUID(), vehicle = randomUUID(), id = randomUUID();
  const service = (await query<{ id: string }>("SELECT id FROM wl.services LIMIT 1"))[0].id;
  await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone) VALUES($1,'Payment','Test',$2,'+13125550199')", [customer, `payment-${customer}@example.test`]);
  await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Test','Car',2025,'Car')", [vehicle, customer]);
  await query(`INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,price_cents,deposit_cents)
    VALUES($1,$2,'hash',$3,$4,$5,$6,'Full detail','{}','2026-10-26',600,120,$7,$8)`, [id, randomUUID(), "PAY-" + id.slice(0, 8), customer, vehicle, service, price, deposit]);
  return { id, customer };
}
function evidence(id: string, order: string, principal: number, tip = 0, refund = 0): SquarePayment {
  return { id, order_id: order, location_id: "test-location", status: "COMPLETED", amount_money: { amount: principal, currency: "USD" }, tip_money: { amount: tip, currency: "USD" }, total_money: { amount: principal + tip, currency: "USD" }, refunded_money: { amount: refund, currency: "USD" }, created_at: "2026-10-26T12:00:00Z", updated_at: refund ? "2026-10-26T15:00:00Z" : "2026-10-26T13:00:00Z" };
}

test("cash service and tips remain separate, requests are idempotent, balances cannot be over-collected", async () => {
  try {
    const booking = await job(2500);
    const userId = (await query<{ id: string }>("SELECT id FROM wl.users WHERE role='owner' LIMIT 1"))[0].id;
    const owner: Session = { id: "test-session", user_id: userId, role: "owner", name: "Owner", email: "owner@example.test" };
    const input = { booking_id: booking.id, request_id: randomUUID(), amount_cents: 2500, tip_cents: 7500 };
    const saved = await recordJobCashPayment(input, owner);
    assert.equal(saved.balance_due_cents, 0);
    assert.equal(saved.collected_cents, 2500);
    assert.equal(saved.tip_cents, 7500);
    assert.equal((await recordJobCashPayment(input, owner)).already_recorded, true);
    assert.equal((await query("SELECT id FROM wl.payments WHERE booking_id=$1", [booking.id])).length, 1);
    const revenue = (await query<{ amount_cents: number; tip_cents: number }>("SELECT amount_cents,tip_cents FROM wl.revenue_payments WHERE booking_id=$1", [booking.id]))[0];
    assert.equal(Number(revenue.amount_cents), 10000);
    assert.equal(Number(revenue.tip_cents), 7500);
    await assert.rejects(() => recordJobCashPayment({ ...input, amount_cents: 1000 }, owner), /different amounts/);
    await assert.rejects(() => recordJobCashPayment({ ...input, request_id: randomUUID(), amount_cents: 1 }, owner), /more than/);
    await assert.rejects(() => recordJobCashPayment(input, { ...owner, role: "staff" }), /cannot record/);
    const employee = randomUUID();
    await query("INSERT INTO wl.employees(id,name,position) VALUES($1,'Tip recipient','Detailer')", [employee]);
    await query("INSERT INTO wl.employee_job_assignments(id,booking_id,employee_id,pool_share_bps,tip_override_cents) VALUES($1,$2,$3,10000,7500)", [randomUUID(), booking.id, employee]);
    const extraTip = await recordJobCashPayment({ ...input, request_id: randomUUID(), amount_cents: 0, tip_cents: 500 }, owner);
    assert.equal(extraTip.balance_due_cents, 0);
    assert.equal(extraTip.tip_cents, 8000);
    assert.equal((await query<{ tip_override_cents: number }>("SELECT tip_override_cents FROM wl.employee_job_assignments WHERE booking_id=$1", [booking.id]))[0].tip_override_cents, 8000);

    const depositJob = await job(55000, 20000);
    await query("INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,status,provider,kind,paid_at) VALUES($1,$2,$3,20000,'paid','manual','deposit',now())", [randomUUID(), depositJob.id, depositJob.customer]);
    const collected = await recordJobCashPayment({ booking_id: depositJob.id, request_id: randomUUID(), amount_cents: 35000, tip_cents: 5000 }, { ...owner, role: "manager" });
    assert.equal(collected.service_total_cents, 55000);
    assert.equal(collected.collected_cents, 55000);
    assert.equal(collected.balance_due_cents, 0);
  } finally { await closeDatabase(); }
});

test("retired Square invoices preserve deposits and tips while revised balance checkout collects only the remainder", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const booking = await job(20000, 10000);
    await query("INSERT INTO wl.square_invoices(booking_id,environment,request_id,invoice_id,order_id,amount_cents,status,url) VALUES($1,'production',$2,'old-invoice','old-order',20000,'PARTIALLY_PAID','https://squareup.com/old-invoice')", [booking.id, randomUUID()]);
    const deposit = evidence("deposit-one", "old-order", 10000, 1000);
    const calls: Array<{ path: string; method: string; body: Record<string, any> }> = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input)), path = url.pathname, method = init?.method || "GET", body = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({ path, method, body });
      if (path === "/v2/invoices/old-invoice" && method === "GET") return Response.json({ invoice: { id: "old-invoice", order_id: "old-order", status: "PARTIALLY_PAID", version: 2 } });
      if (path === "/v2/orders/old-order") return Response.json({ order: { id: "old-order", location_id: "test-location", tenders: [{ payment_id: "deposit-one" }] } });
      if (path === "/v2/payments/deposit-one") return Response.json({ payment: deposit });
      if (path === "/v2/orders/new-order") return Response.json({ order: { id: "new-order", location_id: "test-location", tenders: [{ payment_id: "balance-one" }] } });
      if (path === "/v2/payments/balance-one") return Response.json({ payment: evidence("balance-one", "new-order", 45000, 6000) });
      if (path === "/v2/invoices/old-invoice/cancel") return Response.json({ invoice: { id: "old-invoice", order_id: "old-order", status: "CANCELED", version: 3 } });
      if (path === "/v2/online-checkout/payment-links") return Response.json({ payment_link: { id: "new-link", order_id: "new-order", url: "https://square.link/new-balance" } });
      throw new Error(`Unexpected ${method} ${path}`);
    };
    await transaction(async (q) => {
      await q("SELECT id FROM wl.bookings WHERE id=$1 FOR UPDATE", [booking.id]);
      await prepareJobPriceChange(q, booking.id);
      await q("UPDATE wl.bookings SET price_cents=55000 WHERE id=$1", [booking.id]);
    });
    assert.equal(calls.find((c) => c.path.endsWith("/cancel"))?.body.version, 2);
    const retired = (await query<{ retired_at: string; status: string }>("SELECT retired_at,status FROM wl.square_invoices WHERE booking_id=$1", [booking.id]))[0];
    assert.ok(retired.retired_at);
    assert.equal(retired.status, "CANCELED");
    assert.equal(await createCheckout(booking.id, "balance"), "https://square.link/new-balance");
    const checkout = calls.find((c) => c.path === "/v2/online-checkout/payment-links")!;
    assert.equal(checkout.body.order.line_items[0].base_price_money.amount, 45000);
    assert.equal(checkout.body.checkout_options.allow_tipping, true);
    const userId = (await query<{ id: string }>("SELECT id FROM wl.users WHERE role='owner' LIMIT 1"))[0].id;
    const refreshStart = calls.length;
    const refreshed = await refreshJobPayments(booking.id, { id: "session", user_id: userId, role: "owner", email: "owner@example.test", name: "Owner" });
    assert.equal(refreshed.balance_due_cents, 0);
    assert.equal(refreshed.tip_cents, 7000);
    assert.ok(calls.slice(refreshStart).every((call) => call.method === "GET"));
    // A subsequent old-invoice sync cannot overwrite tips from the new checkout.
    await transaction((q) => upsertSquarePayment(q, deposit, "production"));
    assert.equal((await query<{ tip_cents: number }>("SELECT tip_cents FROM wl.bookings WHERE id=$1", [booking.id]))[0].tip_cents, 7000);
    const amounts = (await query<{ paid: number }>("SELECT SUM(amount_cents-refunded_cents)::int paid FROM wl.payments WHERE booking_id=$1 AND status='paid'", [booking.id]))[0];
    assert.equal(amounts.paid, 55000);
    assert.equal((await query<{ status: string }>("SELECT status FROM wl.square_invoices WHERE booking_id=$1", [booking.id]))[0].status, "CANCELED");
    await transaction((q) => upsertSquarePayment(q, evidence("balance-one", "new-order", 45000, 6000, 51000), "production", { reconcileInvoice: true }));
    assert.equal((await query<{ tip_cents: number }>("SELECT tip_cents FROM wl.bookings WHERE id=$1", [booking.id]))[0].tip_cents, 1000);
    assert.equal(calls.some((c) => c.path.includes("refund")), false);
  } finally { globalThis.fetch = originalFetch; await closeDatabase(); }
});

test("changing a job closes pending checkout links and tolerates a previous successful cancellation", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const booking = await job(10000), payment = randomUUID();
    await query("INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,provider,checkout_url,metadata) VALUES($1,$2,$3,10000,'square','https://square.link/old',$4::jsonb)", [payment, booking.id, booking.customer, JSON.stringify({ square_environment: "production", square_order_id: "pending-order", square_payment_link_id: "pending-link", square_location_id: "test-location" })]);
    const methods: string[] = [];
    globalThis.fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      methods.push(String(init?.method));
      if (path === "/v2/orders/pending-order") return Response.json({ order: { id: "pending-order", location_id: "test-location", reference_id: payment, tenders: [] } });
      if (path === "/v2/online-checkout/payment-links/pending-link" && init?.method === "DELETE") return new Response("{}", { status: 404 });
      throw new Error("Unexpected Square request");
    };
    await transaction((q) => prepareJobPriceChange(q, booking.id));
    assert.equal((await query<{ status: string }>("SELECT status FROM wl.payments WHERE id=$1", [payment]))[0].status, "expired");
    assert.deepEqual(methods, ["GET", "DELETE", "GET"]);
  } finally { globalThis.fetch = originalFetch; await closeDatabase(); }
});

test("deposit and full-balance checkouts cannot leave two payable links for the same job", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const booking = await job(55000, 20000);
    const orders = new Map<string, { id: string; location_id: string; reference_id: string; tenders: Array<{ payment_id: string }> }>();
    const deleted: string[] = [], requestedAmounts: number[] = [];
    let count = 0;
    globalThis.fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/v2/online-checkout/payment-links" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)), orderId = "collection-order-" + ++count;
        orders.set(orderId, { id: orderId, location_id: "test-location", reference_id: body.order.reference_id, tenders: [] });
        requestedAmounts.push(body.order.line_items[0].base_price_money.amount);
        return Response.json({ payment_link: { id: "collection-link-" + count, order_id: orderId, url: "https://square.link/collection-" + count } });
      }
      if (path.startsWith("/v2/orders/")) return Response.json({ order: orders.get(path.split("/").pop()!) });
      if (path.startsWith("/v2/online-checkout/payment-links/") && init?.method === "DELETE") { deleted.push(path.split("/").pop()!); return Response.json({ id: deleted.at(-1) }); }
      throw new Error("Unexpected request " + path);
    };
    assert.equal(await createCheckout(booking.id, "balance"), "https://square.link/collection-1");
    assert.equal(await createCheckout(booking.id, "deposit"), "https://square.link/collection-2");
    assert.deepEqual(deleted, ["collection-link-1"]);
    assert.equal((await query("SELECT id FROM wl.payments WHERE booking_id=$1 AND status='pending'", [booking.id])).length, 1);
    await transaction((q) => upsertSquarePayment(q, evidence("collection-deposit", "collection-order-2", 20000), "production", { reconcileInvoice: true }));
    assert.equal(await createCheckout(booking.id, "balance"), "https://square.link/collection-3");
    assert.deepEqual(requestedAmounts, [55000, 20000, 35000]);
    assert.equal(await createCheckout(booking.id, "balance"), "https://square.link/collection-3");
    assert.equal(count, 3, "same valid checkout is reused under the booking lock");
    const another = await job(55000, 20000);
    const concurrent = await Promise.allSettled([createCheckout(another.id, "deposit"), createCheckout(another.id, "balance")]);
    assert.ok(concurrent.some((result) => result.status === "fulfilled"));
    assert.equal((await query("SELECT id FROM wl.payments WHERE booking_id=$1 AND status='pending'", [another.id])).length, 1);
  } finally { globalThis.fetch = originalFetch; await closeDatabase(); }
});

test("split Square order receipts have one job owner and remaining tenders stay matchable to that job", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const first = await job(4000), second = await job(4000);
    const userId = (await query<{ id: string }>("SELECT id FROM wl.users WHERE role='owner' LIMIT 1"))[0].id;
    const owner: Session = { id: "test-session", user_id: userId, role: "owner", name: "Owner", email: "owner@example.test" };
    const receipts = [evidence("split-one", "split-order", 2000, 500), evidence("split-two", "split-order", 2000, 1000)];
    globalThis.fetch = async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/v2/payments") return Response.json({ payments: receipts });
      return Response.json({ payment: receipts.find((p) => path.endsWith("/" + p.id)) });
    };
    const result = await Promise.allSettled([
      linkSquareJobPayment({ booking_id: first.id, payment_id: "split-one" }, owner),
      linkSquareJobPayment({ booking_id: second.id, payment_id: "split-two" }, owner),
    ]);
    assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(result.filter((r) => r.status === "rejected").length, 1);
    const target = result[0].status === "fulfilled" ? first : second;
    const receiptId = result[0].status === "fulfilled" ? "split-two" : "split-one";
    const options = await listUnlinkedSquareJobPayments(target.id, owner);
    assert.ok(options.payments.some((p) => p.payment_id === receiptId));
    const matched = await linkSquareJobPayment({ booking_id: target.id, payment_id: receiptId }, owner);
    assert.equal(matched.collected_cents, 4000);
    assert.equal(matched.tip_cents, 1500);
    assert.equal(matched.balance_due_cents, 0);
  } finally { globalThis.fetch = originalFetch; await closeDatabase(); }
});

test("saved invoice checkout URLs require current Square account ownership and location evidence", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const booking = await job(20000, 10000);
    await query("INSERT INTO wl.square_invoices(booking_id,environment,request_id,invoice_id,order_id,amount_cents,status,url) VALUES($1,'production',$2,'account-invoice','account-order',20000,'UNPAID','https://square.link/old-account')", [booking.id, randomUUID()]);
    globalThis.fetch = async () => new Response("{}", { status: 404 });
    await assert.rejects(() => createCheckout(booking.id), /Square could not/);
    let location = "old-account-location";
    globalThis.fetch = async (input) => new URL(String(input)).pathname.startsWith("/v2/invoices/")
      ? Response.json({ invoice: { id: "account-invoice", order_id: "account-order", status: "UNPAID", version: 1, public_url: "https://square.link/verified-account" } })
      : Response.json({ order: { id: "account-order", location_id: location, tenders: [] } });
    await assert.rejects(() => createCheckout(booking.id), /do not match/);
    location = "test-location";
    assert.equal(await createCheckout(booking.id), "https://square.link/verified-account");
  } finally { globalThis.fetch = originalFetch; await closeDatabase(); }
});

test("POS receipts match by authoritative payment id once and reject wrong jobs, accounts, amounts and incomplete payments", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const booking = await job(2500), another = await job(2500);
    const userId = (await query<{ id: string }>("SELECT id FROM wl.users WHERE role='owner' LIMIT 1"))[0].id;
    const manager: Session = { id: "test-session", user_id: userId, role: "manager", name: "Manager", email: "manager@example.test" };
    let payment = evidence("pos-receipt", "pos-order", 2500, 7500);
    globalThis.fetch = async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/v2/payments") return Response.json({ payments: [payment] });
      if (path === "/v2/payments/pos-receipt") return Response.json({ payment });
      throw new Error("Unexpected request " + path);
    };
    const candidates = await listUnlinkedSquareJobPayments(booking.id, manager);
    assert.equal(candidates.payments.length, 1);
    assert.equal(Number(candidates.payments[0].principal_cents), 2500);
    assert.equal(Number(candidates.payments[0].tip_cents), 7500);
    await assert.rejects(() => linkSquareJobPayment({ booking_id: booking.id, payment_id: "pos-receipt" }, { ...manager, role: "staff" }), /cannot manage/);
    payment = { ...payment, status: "APPROVED" };
    await assert.rejects(() => linkSquareJobPayment({ booking_id: booking.id, payment_id: "pos-receipt" }, manager), /completed USD/);
    payment = { ...payment, status: "COMPLETED", location_id: "other-merchant-location" };
    await assert.rejects(() => linkSquareJobPayment({ booking_id: booking.id, payment_id: "pos-receipt" }, manager), /different Square location/);
    payment = evidence("pos-receipt", "pos-order", 5000, 7500);
    await assert.rejects(() => linkSquareJobPayment({ booking_id: booking.id, payment_id: "pos-receipt" }, manager), /more than/);
    payment = evidence("pos-receipt", "pos-order", 2500, 7500);
    const matched = await linkSquareJobPayment({ booking_id: booking.id, payment_id: "pos-receipt" }, manager);
    assert.equal(matched.balance_due_cents, 0);
    assert.equal(matched.tip_cents, 7500);
    assert.equal(matched.collected_cents, 2500);
    assert.equal((await linkSquareJobPayment({ booking_id: booking.id, payment_id: "pos-receipt" }, manager)).already_linked, true);
    assert.equal((await query("SELECT id FROM wl.payments WHERE booking_id=$1", [booking.id])).length, 1);
    assert.equal((await listUnlinkedSquareJobPayments(booking.id, manager)).payments.length, 0);
    await assert.rejects(() => linkSquareJobPayment({ booking_id: another.id, payment_id: "pos-receipt" }, manager), /another job/);
    const revenue = (await query<{ amount_cents: number; tip_cents: number }>("SELECT amount_cents,tip_cents FROM wl.revenue_payments WHERE booking_id=$1", [booking.id]));
    assert.equal(revenue.length, 1);
    assert.equal(Number(revenue[0].amount_cents), 10000);
    assert.equal(Number(revenue[0].tip_cents), 7500);
    payment = evidence("pos-receipt", "pos-order", 2500, 7500, 3000);
    const refund = await linkSquareJobPayment({ booking_id: booking.id, payment_id: "pos-receipt" }, manager);
    assert.equal(refund.collected_cents, 0);
    assert.equal(refund.tip_cents, 7000);
    assert.equal(refund.balance_due_cents, 2500);
  } finally { globalThis.fetch = originalFetch; await closeDatabase(); }
});

test("in-progress Square money blocks retirement and newer canonical refunds limit receipt matching", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const booking = await job(20000, 10000);
    await query("INSERT INTO wl.square_invoices(booking_id,environment,request_id,invoice_id,order_id,amount_cents,status) VALUES($1,'production',$2,'busy-invoice','busy-order',20000,'UNPAID')", [booking.id, randomUUID()]);
    let cancelCalls = 0;
    globalThis.fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/v2/invoices/busy-invoice") return Response.json({ invoice: { id: "busy-invoice", order_id: "busy-order", status: "UNPAID", version: 2 } });
      if (path === "/v2/orders/busy-order") return Response.json({ order: { id: "busy-order", location_id: "test-location", tenders: [{ payment_id: "processing-payment" }] } });
      if (path === "/v2/payments/processing-payment") return Response.json({ payment: { ...evidence("processing-payment", "busy-order", 10000), status: "APPROVED" } });
      if (init?.method === "POST") cancelCalls++;
      throw new Error("Unexpected request " + path);
    };
    await assert.rejects(() => transaction((q) => prepareJobPriceChange(q, booking.id)), /still processing/);
    assert.equal(cancelCalls, 0);
    assert.equal((await query<{ retired_at: string | null }>("SELECT retired_at FROM wl.square_invoices WHERE booking_id=$1", [booking.id]))[0].retired_at, null);

    const target = await job(2500);
    const userId = (await query<{ id: string }>("SELECT id FROM wl.users WHERE role='owner' LIMIT 1"))[0].id;
    const owner: Session = { id: "test-session", user_id: userId, role: "owner", name: "Owner", email: "owner@example.test" };
    const older = evidence("stale-receipt", "stale-order", 2500, 500);
    await transaction((q) => upsertSquarePayment(q, evidence("stale-receipt", "stale-order", 2500, 500, 1000), "production"));
    globalThis.fetch = async () => Response.json({ payment: older });
    const matched = await linkSquareJobPayment({ booking_id: target.id, payment_id: "stale-receipt" }, owner);
    assert.equal(matched.collected_cents, 1500);
    assert.equal(matched.balance_due_cents, 1000);
    assert.equal(matched.tip_cents, 500);
  } finally { globalThis.fetch = originalFetch; await closeDatabase(); }
});
