import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "./auth";
import { transaction, type Query } from "./db";
import { secret } from "./settings";
import type { Session } from "./types";
import { SQUARE_API_VERSION, squareApiBase, squareEnvironment, squareAccountScope, upsertSquarePayment, normalizeSquarePayment, type SquarePayment } from "../integrations/square-reporting";
import { updateJobTipTotal, syncJobSquareTips } from "../integrations/square-invoice-ledger";

type SavedInvoice = { invoice_id: string; order_id: string; status: string; retired_at: string | null };
type Order = { id: string; location_id: string; reference_id?: string; tenders?: Array<{ payment_id?: string }> };
type Invoice = { id: string; order_id: string; status: string; version: number };
type Pending = { id: string; status: string; checkout_url: string; metadata: { square_order_id?: string; square_payment_link_id?: string; square_location_id?: string } };

async function squareRequest<T>(q: Query, path: string, method = "GET", body?: unknown, allowMissing = false): Promise<T | null> {
  const token = await secret("square_access_token", q);
  if (!token) throw new AppError("Connect Square before changing a job with an active payment link.", 503);
  let response: Response;
  try {
    response = await fetch(squareApiBase() + path, {
      method, headers: { Authorization: "Bearer " + token, "Square-Version": SQUARE_API_VERSION, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000), cache: "no-store",
    });
  } catch { throw new AppError("Square could not verify the existing payment link. Retry before changing this job.", 502); }
  if (allowMissing && response.status === 404) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new AppError(result.errors?.[0]?.detail || "Square could not close the previous payment link. The job has not been changed.", 502);
  return result as T;
}

async function refreshOrder(q: Query, orderId: string, expectedLocation?: string, expectedReference?: string, blockProcessing = true) {
  const result = await squareRequest<{ order: Order }>(q, "/v2/orders/" + encodeURIComponent(orderId));
  const order = result?.order;
  if (!order || order.id !== orderId || !order.location_id || (expectedLocation && order.location_id !== expectedLocation) || (expectedReference && order.reference_id && order.reference_id !== expectedReference))
    throw new AppError("Square order details do not match this job. Review the payment before making changes.", 502);
  if (order.tenders !== undefined && !Array.isArray(order.tenders)) throw new AppError("Square returned incomplete payment details.", 502);
  for (const paymentId of [...new Set((order.tenders || []).map((t) => t.payment_id).filter((id): id is string => Boolean(id)))]) {
    const evidence = (await squareRequest<{ payment: SquarePayment }>(q, "/v2/payments/" + encodeURIComponent(paymentId)))?.payment;
    if (!evidence || evidence.id !== paymentId || evidence.order_id !== orderId || evidence.location_id !== order.location_id || (expectedLocation && evidence.location_id !== expectedLocation))
      throw new AppError("Square payment details do not match this job.", 502);
    if (blockProcessing && ["APPROVED", "PENDING"].includes(evidence.status || "")) throw new AppError("A customer payment is still processing. Wait for it to complete before changing the job.", 409);
    if (evidence.status === "COMPLETED" && normalizeSquarePayment(evidence, squareEnvironment()).currency !== "USD") throw new AppError("This order contains a payment in a different currency. Review it in Square before changing the job.", 409);
    await upsertSquarePayment(q, evidence, squareEnvironment(), { reconcileInvoice: true });
  }
}

/** Stored invoice URLs are never trusted across a Square account change. */
export async function verifiedSquareInvoiceCheckout(bookingId: string): Promise<string | null> {
  return transaction(async (q) => {
    const booking = (await q<{ status: string }>("SELECT status FROM wl.bookings WHERE id=$1 FOR UPDATE", [bookingId])).rows[0];
    if (!booking || ["cancelled", "no_show"].includes(booking.status)) throw new AppError("This appointment cannot be paid online.");
    const saved = (await q<SavedInvoice>("SELECT * FROM wl.square_invoices WHERE booking_id=$1 AND environment=$2 AND retired_at IS NULL FOR UPDATE", [bookingId, squareEnvironment()])).rows[0];
    if (!saved) return null;
    if (!saved.invoice_id) throw new AppError("Finish creating this booking’s Square invoice from the admin panel.");
    const current = (await squareRequest<{ invoice: Invoice & { public_url?: string } }>(q, "/v2/invoices/" + encodeURIComponent(saved.invoice_id)))?.invoice;
    if (!current || current.id !== saved.invoice_id || current.order_id !== saved.order_id) throw new AppError("Square could not verify this invoice with the current account. Review it before collecting payment.", 502);
    const location = await secret("square_location_id", q);
    if (!location) throw new AppError("Connect the Square location first.", 503);
    await refreshOrder(q, saved.order_id, location, undefined, false);
    if (["PAID", "REFUNDED", "PARTIALLY_REFUNDED", "CANCELED", "FAILED"].includes(current.status)) {
      await q("UPDATE wl.square_invoices SET retired_at=now(),status=$3,updated_at=now() WHERE booking_id=$1 AND environment=$2", [bookingId, squareEnvironment(), current.status]);
      return null;
    }
    if (!["SCHEDULED", "UNPAID", "PARTIALLY_PAID"].includes(current.status) || !current.public_url)
      throw new AppError("The Square invoice is still being prepared or a payment is processing. Refresh and try again.", 409);
    await q("UPDATE wl.square_invoices SET url=$3,status=$4,updated_at=now() WHERE booking_id=$1 AND environment=$2", [bookingId, squareEnvironment(), current.public_url, current.status]);
    return current.public_url;
  });
}

/** Caller holds the booking lock. Retiring collection never refunds a payment. */
export async function prepareJobPriceChange(q: Query, bookingId: string) {
  const environment = squareEnvironment();
  if ((await q("SELECT id FROM wl.payments WHERE booking_id=$1 AND status='pending' AND checkout_url<>'' AND (provider<>'square' OR COALESCE(metadata->>'square_environment','') NOT IN ('production','sandbox')) LIMIT 1", [bookingId])).rows.length)
    throw new AppError("An older payment link needs review. Close it with its payment provider before changing this job.", 409);
  const invoice = (await q<SavedInvoice>("SELECT * FROM wl.square_invoices WHERE booking_id=$1 AND environment=$2 FOR UPDATE", [bookingId, environment])).rows[0];
  if (invoice && !invoice.retired_at) {
    if (!invoice.invoice_id) throw new AppError("Finish creating this job’s Square invoice, then retry the price change.", 409);
    let current = (await squareRequest<{ invoice: Invoice }>(q, "/v2/invoices/" + encodeURIComponent(invoice.invoice_id), "GET", undefined, true))?.invoice;
    if (current && (current.id !== invoice.invoice_id || current.order_id !== invoice.order_id)) throw new AppError("Square invoice does not match this job.", 502);
    if (invoice.order_id) await refreshOrder(q, invoice.order_id);
    if (current && ["SCHEDULED", "UNPAID", "PARTIALLY_PAID"].includes(current.status)) {
      current = (await squareRequest<{ invoice: Invoice }>(q, "/v2/invoices/" + encodeURIComponent(current.id) + "/cancel", "POST", { version: current.version }))?.invoice;
      if (current?.status !== "CANCELED") throw new AppError("Square has not canceled the old invoice. Retry before changing the job.", 502);
      if (invoice.order_id) await refreshOrder(q, invoice.order_id);
    } else if (current?.status === "DRAFT") {
      await squareRequest(q, "/v2/invoices/" + encodeURIComponent(current.id) + "?version=" + current.version, "DELETE", undefined, true);
      current = undefined;
    } else if (current && !["PAID", "REFUNDED", "PARTIALLY_REFUNDED", "CANCELED", "FAILED"].includes(current.status))
      throw new AppError("The Square invoice has a payment in progress. Retry when it finishes.", 409);
    await q("UPDATE wl.square_invoices SET retired_at=now(),status=$3,updated_at=now() WHERE booking_id=$1 AND environment=$2", [bookingId, environment, current?.status || "DELETED"]);
  }
  const pending = (await q<Pending>("SELECT * FROM wl.payments WHERE booking_id=$1 AND provider='square' AND status='pending' AND metadata->>'square_environment'=$2 FOR UPDATE", [bookingId, environment])).rows;
  for (const payment of pending) {
    if (payment.metadata.square_order_id) await refreshOrder(q, payment.metadata.square_order_id, payment.metadata.square_location_id, payment.id);
    const state = (await q<{ status: string }>("SELECT status FROM wl.payments WHERE id=$1", [payment.id])).rows[0];
    if (state.status !== "pending") continue;
    if (payment.metadata.square_order_id && (await q("SELECT payment_id FROM wl.square_payments WHERE environment=$1 AND order_id=$2 AND status='COMPLETED' AND amount_cents>refunded_cents LIMIT 1", [environment, payment.metadata.square_order_id])).rows.length)
      throw new AppError("This checkout has a partial or split payment. Match its receipts before changing the job.", 409);
    if (payment.metadata.square_payment_link_id) {
      await squareRequest(q, "/v2/online-checkout/payment-links/" + encodeURIComponent(payment.metadata.square_payment_link_id), "DELETE", undefined, true);
      if (payment.metadata.square_order_id) await refreshOrder(q, payment.metadata.square_order_id, payment.metadata.square_location_id, payment.id);
    }
    else if (payment.checkout_url) throw new AppError("This older Square link must be closed in Square before changing the job.", 409);
    await q("UPDATE wl.payments SET status='expired',metadata=metadata||jsonb_build_object('retired_for_job_change',true) WHERE id=$1 AND status='pending'", [payment.id]);
  }
}

export async function jobPaymentTotals(q: Query, bookingId: string) {
  const row = (await q<{ price_cents: number; tip_cents: number; collected_cents: number }>(`SELECT b.price_cents,b.tip_cents,
    COALESCE((SELECT SUM(GREATEST(0,p.amount_cents-p.refunded_cents)) FROM wl.payments p WHERE p.booking_id=b.id AND p.status IN ('paid','partially_refunded','refunded')
      AND ((p.provider='square' AND p.metadata->>'square_environment'=$2) OR (p.provider<>'square' AND $2='production'))),0)::int collected_cents
    FROM wl.bookings b WHERE b.id=$1`, [bookingId, squareEnvironment()])).rows[0];
  if (!row) throw new AppError("Booking not found.", 404);
  return { service_total_cents: Number(row.price_cents || 0), collected_cents: Number(row.collected_cents), tip_cents: Number(row.tip_cents), balance_due_cents: Math.max(0, Number(row.price_cents || 0) - Number(row.collected_cents)) };
}

const cashInput = z.object({ booking_id: z.uuid(), request_id: z.uuid(), amount_cents: z.number().int().min(0).max(100000000), tip_cents: z.number().int().min(0).max(100000000).default(0) })
  .refine((value) => value.amount_cents + value.tip_cents > 0, { message: "Enter a cash payment or tip amount." });
async function assertTipPeriodOpen(q: Query, bookingId: string, tip: number) {
  if (tip && (await q(`SELECT pp.id FROM wl.pay_periods pp JOIN wl.payroll_records pr ON pr.pay_period_id=pp.id
    JOIN wl.bookings b ON b.id=$1 WHERE pp.status='paid' AND b.booking_date BETWEEN pp.start_date AND pp.end_date
    AND (pr.employee_id=b.assigned_to OR EXISTS(SELECT 1 FROM wl.employee_job_assignments a WHERE a.booking_id=b.id AND a.employee_id=pr.employee_id)) LIMIT 1`, [bookingId])).rows.length)
    throw new AppError("This job’s payroll is already paid. Record the tip as a payroll adjustment instead.", 409);
}
export async function recordJobCashPayment(raw: unknown, user: Session) {
  if (!["owner", "admin", "manager"].includes(user.role)) throw new AppError("Your role cannot record job payments.", 403);
  if (squareEnvironment() !== "production") throw new AppError("Cash receipts cannot be recorded while Square is in test mode.");
  const input = cashInput.parse(raw);
  const hex = createHash("sha256").update("job-cash:" + input.booking_id + ":" + input.request_id).digest("hex");
  const paymentId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  return transaction(async (q) => {
    const booking = (await q<{ customer_id: string; status: string; price_cents: number | null; manual_tip_cents: number; booking_date: string }>("SELECT * FROM wl.bookings WHERE id=$1 FOR UPDATE", [input.booking_id])).rows[0];
    if (!booking) throw new AppError("Booking not found.", 404);
    const existing = (await q<{ amount_cents: number; tip_cents: number }>("SELECT amount_cents,tip_cents FROM wl.payments WHERE id=$1", [paymentId])).rows[0];
    if (existing) {
      if (Number(existing.amount_cents) !== input.amount_cents || Number(existing.tip_cents) !== input.tip_cents) throw new AppError("This payment request was already recorded with different amounts. Refresh the job before trying again.", 409);
      return { id: paymentId, already_recorded: true, ...await jobPaymentTotals(q, input.booking_id) };
    }
    if (booking.price_cents === null || ["cancelled", "no_show"].includes(booking.status)) throw new AppError("Agree the service price on an active job before recording payment.");
    if ((await q("SELECT id FROM wl.payments WHERE booking_id=$1 AND provider='square' AND status IN ('paid','partially_refunded','refunded') AND COALESCE(metadata->>'square_environment','') NOT IN ('production','sandbox') LIMIT 1", [input.booking_id])).rows.length)
      throw new AppError("Sync Square payments before recording the remaining balance.");
    if ((await q("SELECT id FROM wl.booking_line_items WHERE booking_id=$1 AND quote_pending LIMIT 1", [input.booking_id])).rows.length) throw new AppError("Agree all upgrade prices before recording payment.");
    await assertTipPeriodOpen(q, input.booking_id, input.tip_cents);
    if (input.amount_cents > (await jobPaymentTotals(q, input.booking_id)).balance_due_cents) throw new AppError("The service payment is more than the remaining balance. Enter any extra amount as a tip.");
    await prepareJobPriceChange(q, input.booking_id);
    const totals = await jobPaymentTotals(q, input.booking_id);
    if (input.amount_cents > totals.balance_due_cents) throw new AppError("The service payment is more than the remaining balance. Enter any extra amount as a tip.");
    await q(`INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,tip_cents,status,kind,provider,payment_method,paid_at,metadata)
      VALUES($1,$2,$3,$4,$5,'paid','balance','manual','Cash',now(),$6::jsonb)`, [paymentId, input.booking_id, booking.customer_id, input.amount_cents, input.tip_cents, JSON.stringify({ request_id: input.request_id, recorded_by: user.user_id })]);
    if (input.tip_cents) await updateJobTipTotal(q, input.booking_id, Number(booking.manual_tip_cents) + input.tip_cents, "manual");
    await q("UPDATE wl.bookings SET status=CASE WHEN status='new' AND $2>=deposit_cents THEN 'confirmed' ELSE status END,updated_at=now() WHERE id=$1", [input.booking_id, totals.collected_cents + input.amount_cents]);
    await q("INSERT INTO wl.timeline(id,customer_id,booking_id,type,body,actor_id) VALUES($1,$2,$3,'payment_received',$4,$5)", [randomUUID(), booking.customer_id, input.booking_id, `Cash received: $${(input.amount_cents / 100).toFixed(2)} service + $${(input.tip_cents / 100).toFixed(2)} tip.`, user.user_id]);
    await q("INSERT INTO wl.audit_logs(id,actor_id,entity_type,entity_id,action,after_data) VALUES($1,$2,'payment',$3,'cash_recorded',$4::jsonb)", [randomUUID(), user.user_id, paymentId, JSON.stringify(input)]);
    return { id: paymentId, already_recorded: false, ...await jobPaymentTotals(q, input.booking_id) };
  });
}

function requirePaymentManager(user: Session) {
  if (!["owner", "admin", "manager"].includes(user.role)) throw new AppError("Your role cannot manage job payments.", 403);
}

/** Refresh only this job's saved Square orders/payments; never close links. */
export async function refreshJobPayments(bookingId: string, user: Session) {
  requirePaymentManager(user);
  z.uuid().parse(bookingId);
  return transaction(async (q) => {
    if (!(await q("SELECT id FROM wl.bookings WHERE id=$1 FOR UPDATE", [bookingId])).rows.length) throw new AppError("Booking not found.", 404);
    const environment = squareEnvironment();
    const invoice = (await q<{ order_id: string }>("SELECT order_id FROM wl.square_invoices WHERE booking_id=$1 AND environment=$2 AND order_id<>''", [bookingId, environment])).rows[0];
    const payments = (await q<{ external_id: string; metadata: { square_order_id?: string; square_location_id?: string } }>("SELECT external_id,metadata FROM wl.payments WHERE booking_id=$1 AND provider='square' AND metadata->>'square_environment'=$2 ORDER BY created_at", [bookingId, environment])).rows;
    const orders = new Map<string, string | undefined>();
    if (invoice?.order_id) orders.set(invoice.order_id, undefined);
    for (const payment of payments) if (payment.metadata.square_order_id) orders.set(payment.metadata.square_order_id, payment.metadata.square_location_id);
    for (const [orderId, location] of orders) await refreshOrder(q, orderId, location, undefined, false);
    // Cash/card-reader receipts sometimes have no order. Refresh those by their
    // stored payment ids so later refunds and tips still reach the job.
    for (const payment of payments.filter((p) => !p.metadata.square_order_id && p.external_id)) {
      const evidence = (await squareRequest<{ payment: SquarePayment }>(q, "/v2/payments/" + encodeURIComponent(payment.external_id)))?.payment;
      if (!evidence || evidence.id !== payment.external_id || (payment.metadata.square_location_id && evidence.location_id !== payment.metadata.square_location_id)) throw new AppError("Square payment details do not match this job.", 502);
      await upsertSquarePayment(q, evidence, environment, { reconcileInvoice: true });
    }
    return { refreshed: true, ...await jobPaymentTotals(q, bookingId) };
  });
}

/** A bounded recent receipt list; no customer records or charges are created. */
export async function listUnlinkedSquareJobPayments(bookingId: string, user: Session) {
  requirePaymentManager(user);
  z.uuid().parse(bookingId);
  return transaction(async (q) => {
    if (!(await q("SELECT id FROM wl.bookings WHERE id=$1", [bookingId])).rows.length) throw new AppError("Booking not found.", 404);
    const location = await secret("square_location_id", q);
    if (!location) throw new AppError("Connect the Square location first.", 503);
    const params = new URLSearchParams({ location_id: location, limit: "100", sort_order: "DESC", begin_time: new Date(Date.now() - 30 * 86400000).toISOString() });
    const recent = await squareRequest<{ payments?: SquarePayment[] }>(q, "/v2/payments?" + params);
    if (recent?.payments !== undefined && !Array.isArray(recent.payments)) throw new AppError("Square returned incomplete receipt information.", 502);
    for (const payment of recent?.payments || []) await upsertSquarePayment(q, payment, squareEnvironment(), { reconcileInvoice: true });
    const payments = (await q(`SELECT s.payment_id,s.amount_cents,s.tip_cents,s.refunded_cents,
      GREATEST(0,s.amount_cents-s.tip_cents-LEAST(s.amount_cents-s.tip_cents,s.refunded_cents))::int principal_cents,
      s.paid_at,s.payment_method,s.receipt_url FROM wl.square_payments s
      WHERE s.environment=$1 AND s.status='COMPLETED' AND s.currency='USD' AND s.amount_cents>s.refunded_cents AND ${squareAccountScope("s")}
      AND NOT EXISTS(SELECT 1 FROM wl.payments p WHERE p.provider='square' AND COALESCE(p.metadata->>'square_environment','') IN ('',s.environment)
        AND (p.external_id=s.payment_id OR (s.order_id<>'' AND p.metadata->>'square_order_id'=s.order_id AND p.booking_id<>$2)))
      AND NOT EXISTS(SELECT 1 FROM wl.square_invoices i WHERE i.environment=s.environment AND i.order_id=s.order_id AND i.order_id<>'')
      ORDER BY s.paid_at DESC NULLS LAST,s.payment_id LIMIT 100`, [squareEnvironment(), bookingId])).rows;
    return { payments, ...await jobPaymentTotals(q, bookingId) };
  });
}

export async function linkSquareJobPayment(raw: unknown, user: Session) {
  requirePaymentManager(user);
  const input = z.object({ booking_id: z.uuid(), payment_id: z.string().min(1).max(200) }).parse(raw);
  const environment = squareEnvironment();
  return transaction(async (q) => {
    // Same receipt cannot be attached to two jobs by simultaneous managers.
    await q("SELECT pg_advisory_xact_lock(hashtext($1))", ["square-receipt:" + environment + ":" + input.payment_id]);
    const booking = (await q<{ customer_id: string; price_cents: number | null; status: string }>("SELECT * FROM wl.bookings WHERE id=$1 FOR UPDATE", [input.booking_id])).rows[0];
    if (!booking) throw new AppError("Booking not found.", 404);
    if (booking.price_cents === null || ["cancelled", "no_show"].includes(booking.status)) throw new AppError("Agree the service price on an active job before matching payment.");
    const evidence = (await squareRequest<{ payment: SquarePayment }>(q, "/v2/payments/" + encodeURIComponent(input.payment_id)))?.payment;
    if (!evidence || evidence.id !== input.payment_id) throw new AppError("Square did not return the selected payment.", 502);
    let receipt = normalizeSquarePayment(evidence, environment);
    if (receipt.status !== "COMPLETED" || receipt.currency !== "USD") throw new AppError("Only a completed USD Square payment can be matched.");
    const configured = await secret("square_location_id", q);
    const locations = (await q<{ locations: string[] }>("SELECT value->$1 locations FROM wl.settings WHERE key='square_account_locations'", [environment])).rows[0]?.locations;
    if (!receipt.location_id || !(Array.isArray(locations) && locations.length ? locations.includes(receipt.location_id) : receipt.location_id === configured))
      throw new AppError("This payment belongs to a different Square location.");
    if (receipt.order_id) await q("SELECT pg_advisory_xact_lock(hashtext($1))", ["square-order:" + environment + ":" + receipt.order_id]);
    const linked = (await q<{ id: string; booking_id: string; external_id: string; status: string }>(`SELECT id,booking_id,external_id,status FROM wl.payments WHERE provider='square' AND COALESCE(metadata->>'square_environment','') IN ('',$3)
      AND (external_id=$1 OR ($2<>'' AND metadata->>'square_order_id'=$2)) FOR UPDATE`, [receipt.payment_id, receipt.order_id, environment])).rows;
    const invoice = (await q<{ booking_id: string }>("SELECT booking_id FROM wl.square_invoices WHERE environment=$1 AND order_id=$2 AND order_id<>''", [environment, receipt.order_id])).rows[0];
    if (linked.some((p) => p.booking_id !== input.booking_id) || (invoice && invoice.booking_id !== input.booking_id)) throw new AppError("This Square payment is already linked to another job.", 409);
    if (linked.some((payment) => payment.external_id === receipt.payment_id) || invoice) {
      await upsertSquarePayment(q, evidence, environment, { reconcileInvoice: true });
      return { already_linked: true, ...await jobPaymentTotals(q, input.booking_id) };
    }
    if (linked.some((payment) => payment.status === "pending")) throw new AppError("This receipt belongs to a checkout already attached to the job. Refresh its payment status first.", 409);
    // A newer webhook snapshot can already include a refund not yet present in
    // the GET response. Use the monotonic ledger result for balance credit.
    receipt = await upsertSquarePayment(q, evidence, environment);
    const principal = Math.max(0, Number(receipt.amount_cents) - Number(receipt.tip_cents));
    const refundedPrincipal = Math.min(principal, Number(receipt.refunded_cents));
    const netPrincipal = principal - refundedPrincipal;
    const netTip = Math.max(0, Number(receipt.tip_cents) - Math.max(0, Number(receipt.refunded_cents) - principal));
    await assertTipPeriodOpen(q, input.booking_id, netTip);
    if (Number(receipt.amount_cents) <= Number(receipt.refunded_cents)) throw new AppError("This payment was fully refunded and cannot settle the job.");
    if ((await q("SELECT id FROM wl.booking_line_items WHERE booking_id=$1 AND quote_pending LIMIT 1", [input.booking_id])).rows.length) throw new AppError("Agree all upgrade prices before matching payment.");
    if (netPrincipal > (await jobPaymentTotals(q, input.booking_id)).balance_due_cents) throw new AppError("This receipt is more than the job’s remaining service balance. Check the agreed price and selected receipt first.");
    await prepareJobPriceChange(q, input.booking_id);
    if (netPrincipal > (await jobPaymentTotals(q, input.booking_id)).balance_due_cents) throw new AppError("Another payment was received. Refresh the job before matching this receipt.", 409);
    const id = randomUUID();
    await q(`INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,tip_cents,refunded_cents,status,kind,provider,external_id,paid_at,processor_fee_cents,payment_method,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,'balance','square',$8,$9,$10,$11,$12::jsonb)`, [id, input.booking_id, booking.customer_id, principal, netTip, refundedPrincipal, refundedPrincipal >= principal && refundedPrincipal > 0 ? "refunded" : refundedPrincipal > 0 ? "partially_refunded" : "paid", receipt.payment_id, receipt.paid_at, Math.max(0, Number(receipt.processor_fee_cents)), receipt.payment_method, JSON.stringify({ square_environment: environment, square_order_id: receipt.order_id, square_location_id: receipt.location_id, matched_by: user.user_id })]);
    await syncJobSquareTips(q, input.booking_id, environment);
    const totals = await jobPaymentTotals(q, input.booking_id);
    await q("UPDATE wl.bookings SET status=CASE WHEN status='new' AND $2>=deposit_cents THEN 'confirmed' ELSE status END,updated_at=now() WHERE id=$1", [input.booking_id, totals.collected_cents]);
    await q("INSERT INTO wl.audit_logs(id,actor_id,entity_type,entity_id,action,after_data) VALUES($1,$2,'payment',$3,'square_receipt_matched',$4::jsonb)", [randomUUID(), user.user_id, id, JSON.stringify(input)]);
    return { id, already_linked: false, ...totals };
  });
}
