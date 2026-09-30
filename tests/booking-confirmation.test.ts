import test from "node:test";
import assert from "node:assert/strict";
import type { BookingReceipt } from "../lib/platform/receipts";
import { appointmentDate, confirmationView, needsPaymentVerification } from "../components/westloop/booking-confirmation-state";
import { pollBookingStatus } from "../components/westloop/booking-status-poll";

const booking: BookingReceipt = {
  id: "booking", reference: "WLC-TEST", status: "new", serviceName: "Full detail", vehicle: "Porsche 911",
  date: "2026-10-12", startMinute: 540, location: "Studio", priceCents: 50_000, depositCents: 10_000,
  paidCents: 0, refundedCents: 0, provider: "square", payments: [], pendingPayment: false, failedPayment: false, quoteBased: false,
};
const depositPaid: BookingReceipt = { ...booking, status: "confirmed", paidCents: 10_000, payments: [{ id: "deposit", amount_cents: 10_000 }] };
const response = (receipt: BookingReceipt, verificationUnavailable = false) => new Response(JSON.stringify({ ok: true, receipt, verificationUnavailable }), { headers: { "Content-Type": "application/json" } });

test("a checkout return never substitutes for a recorded payment, even after polling times out", () => {
  for (const exhausted of [false, true]) {
    const view = confirmationView(booking, { returned: true, checked: true, exhausted });
    assert.equal(view.kind, "pending");
    assert.equal(view.canPay, false);
    assert.match(view.message, /don’t pay again/);
    assert.notEqual(view.title, "You’re all set.");
  }
});

test("verified deposits and full payments confirm the appointment with accurate remaining balances", () => {
  const deposit = confirmationView(depositPaid, { checkoutHint: "cancelled" });
  assert.equal(deposit.kind, "paid_confirmed");
  assert.equal(deposit.badge, "Deposit paid");
  assert.equal(deposit.balanceCents, 40_000);
  assert.equal(deposit.offerDeposit, false);
  assert.equal(deposit.canPay, true);
  const paid = confirmationView({ ...depositPaid, paidCents: 50_000 }, { checkoutHint: "unavailable" });
  assert.equal(paid.badge, "Paid in full");
  assert.equal(paid.balanceCents, 0);
  assert.equal(paid.canPay, false);
});

test("a pending balance overrides an earlier paid deposit until the new payment settles", () => {
  const pending = { ...depositPaid, pendingPayment: true };
  const view = confirmationView(pending, { returned: true, checked: true });
  assert.equal(needsPaymentVerification(pending, true), true);
  assert.equal(view.kind, "pending");
  assert.equal(view.title, "Checking your balance payment.");
  assert.equal(view.canPay, false);
  assert.equal(view.resumeCheckout, false);
});

test("no-deposit requests and quote estimates never imply that payment or confirmation occurred", () => {
  const request = confirmationView({ ...booking, depositCents: 0 });
  assert.equal(request.kind, "requested");
  const quote = confirmationView({ ...booking, quoteBased: true, depositCents: 0 });
  assert.equal(quote.kind, "quote");
  assert.equal(quote.canPay, false);
  assert.equal(quote.balanceCents, null);
  const confirmed = confirmationView({ ...booking, status: "confirmed", depositCents: 0 });
  assert.equal(confirmed.kind, "confirmed");
  assert.doesNotMatch(confirmed.message, /payment was received/);
  assert.equal(confirmationView({ ...booking, priceCents: null, quoteBased: true, depositCents: 0 }).kind, "quote");
});

test("failed payments, refunds and terminal appointments retain distinct truthful messages", () => {
  const failed = confirmationView({ ...depositPaid, failedPayment: true });
  assert.equal(failed.kind, "failed");
  assert.match(failed.message, /earlier payment is still recorded/);
  const refunded = confirmationView({ ...depositPaid, paidCents: 5_000, refundedCents: 5_000 });
  assert.equal(refunded.kind, "refunded");
  assert.equal(refunded.canPay, false);
  for (const status of ["cancelled", "no_show", "completed", "in_progress"] as const) {
    const view = confirmationView({ ...depositPaid, status });
    assert.equal(view.kind, status);
    assert.notEqual(view.title, "You’re all set.");
    if (status === "cancelled" || status === "no_show") assert.equal(view.canPay, false);
  }
});

test("abandoned checkout resumes only its exact URL after a successful non-return check", () => {
  const pending = { ...booking, pendingPayment: true, pendingCheckoutUrl: "https://square.link/u/existing-invoice" };
  assert.equal(confirmationView(pending, { checkoutHint: "cancelled" }).resumeCheckout, false);
  const checked = confirmationView(pending, { checkoutHint: "cancelled", checked: true });
  assert.equal(checked.kind, "checkout_incomplete");
  assert.equal(checked.resumeCheckout, true);
  assert.equal(checked.canPay, false, "resuming is separate from creating a new checkout");
  for (const context of [{ returned: true }, { verificationUnavailable: true }, { checking: true }]) {
    assert.equal(confirmationView(pending, { checked: true, ...context }).resumeCheckout, false);
  }
  assert.equal(confirmationView({ ...pending, pendingCheckoutUrl: null }, { checked: true }).resumeCheckout, false);
});

test("the stored appointment date is rendered in Chicago, independent of the visitor timezone", () => {
  const original = process.env.TZ;
  process.env.TZ = "Pacific/Honolulu";
  try { assert.equal(appointmentDate("2026-03-08"), "Sunday, March 8, 2026"); }
  finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});

test("polling posts credentials sequentially and stops immediately when a verified payment arrives", async () => {
  let now = 0, calls = 0, active = 0;
  const snapshots: BookingReceipt[] = [];
  const result = await pollBookingStatus({
    id: booking.id, token: "private-token", returned: true, signal: new AbortController().signal,
    now: () => now, wait: async (ms) => { now += ms; },
    fetcher: async (url, options) => {
      assert.equal(url, "/api/booking/status");
      assert.equal(options?.method, "POST");
      assert.deepEqual(JSON.parse(String(options?.body)), { id: booking.id, token: "private-token" });
      assert.equal(active++, 0);
      await Promise.resolve();
      active--;
      calls++;
      return response(calls < 3 ? { ...booking, pendingPayment: true } : depositPaid);
    },
    onReceipt: (receipt) => snapshots.push(receipt), onUnavailable: () => assert.fail("verification should succeed"),
  });
  assert.equal(result, "settled");
  assert.equal(calls, 3);
  assert.equal(snapshots.at(-1)?.paidCents, 10_000);
  assert.equal(confirmationView(snapshots.at(-1)!, { returned: true }).kind, "paid_confirmed");
});

test("returned pending payments have a total time limit and never become eligible for another payment", async () => {
  let now = 0, calls = 0;
  const pending = { ...depositPaid, pendingPayment: true };
  const result = await pollBookingStatus({
    id: booking.id, token: "private-token", returned: true, signal: new AbortController().signal,
    durationMs: 25, intervalMs: 10, now: () => now, wait: async (ms) => { now += ms; },
    fetcher: async () => { calls++; return response(pending); },
    onReceipt: (receipt) => assert.equal(receipt.paidCents, 10_000), onUnavailable: () => assert.fail("verification should succeed"),
  });
  assert.equal(result, "timeout");
  assert.equal(calls, 3);
  assert.equal(now, 25);
  assert.equal(confirmationView(pending, { returned: true, exhausted: true }).canPay, false);
});

test("non-return checks settle after one successful read, but provider failures cannot unlock checkout", async () => {
  let now = 0, calls = 0;
  const snapshots: boolean[] = [];
  const result = await pollBookingStatus({
    id: booking.id, token: "private-token", returned: false, signal: new AbortController().signal,
    now: () => now, wait: async (ms) => { now += ms; },
    fetcher: async () => { calls++; return response({ ...booking, pendingPayment: true }, calls === 1); },
    onReceipt: (_receipt, unavailable) => snapshots.push(unavailable), onUnavailable: () => assert.fail("HTTP read should succeed"),
  });
  assert.equal(result, "settled");
  assert.equal(calls, 2);
  assert.deepEqual(snapshots, [true, false]);
});

test("aborting a check aborts its request and rejects a late response without updating the page", async () => {
  const controller = new AbortController();
  let resolveResponse!: (value: Response) => void;
  let requestSignal: AbortSignal | null | undefined;
  let updates = 0;
  const running = pollBookingStatus({
    id: booking.id, token: "private-token", returned: true, signal: controller.signal,
    fetcher: async (_url, options) => {
      requestSignal = options?.signal;
      return await new Promise<Response>((resolve) => { resolveResponse = resolve; });
    },
    onReceipt: () => { updates++; }, onUnavailable: () => { updates++; },
  });
  controller.abort();
  resolveResponse(response(depositPaid));
  assert.equal(await running, "aborted");
  assert.equal(requestSignal?.aborted, true);
  assert.equal(updates, 0);
});

test("a stalled request is aborted and reported as unavailable without clearing the receipt", async () => {
  let now = 0, unavailable = 0;
  const result = await pollBookingStatus({
    id: booking.id, token: "private-token", returned: true, signal: new AbortController().signal,
    durationMs: 10, requestTimeoutMs: 5, intervalMs: 10,
    now: () => now, wait: async (ms) => { now += ms; },
    fetcher: async (_url, options) => await new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }),
    onReceipt: () => assert.fail("no new receipt was received"), onUnavailable: () => { unavailable++; },
  });
  assert.equal(result, "timeout");
  assert.equal(unavailable, 1);
});

test("a failed checkout opening can recover after a successful check finds no issued payment", async () => {
  let checked: BookingReceipt | null = null;
  const result = await pollBookingStatus({
    id: booking.id, token: "private-token", returned: false, signal: new AbortController().signal,
    fetcher: async () => response(booking),
    onReceipt: (receipt) => { checked = receipt; }, onUnavailable: () => assert.fail("status should be available"),
  });
  assert.equal(result, "settled");
  assert.ok(checked);
  assert.equal(confirmationView(checked, { checked: true, returned: false }).canPay, true);
  assert.equal(confirmationView(checked, { checked: true, returned: true }).canPay, false, "an actual checkout return still needs a verified result");
});
