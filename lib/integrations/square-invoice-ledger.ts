import type { Query } from "../platform/db";
import type { SquareLedgerPayment } from "./square-reporting";
type Saved = {
  booking_id: string;
  invoice_id: string;
  url: string;
  amount_cents: number;
  retired_at?: string | null;
};
/** Rebuild tips from every linked Square receipt, including retired invoices. */
export async function syncJobSquareTips(q: Query, bookingId: string, environment: string) {
  const activeEnvironment = process.env.SQUARE_ENVIRONMENT?.toLowerCase() === "sandbox" ? "sandbox" : "production";
  if (environment !== activeEnvironment) return;
  const totals = (await q<{ tips: number }>(`SELECT COALESCE(SUM(GREATEST(0,s.tip_cents-GREATEST(0,s.refunded_cents-(s.amount_cents-s.tip_cents)))),0)::int tips
    FROM wl.square_payments s WHERE s.environment=$2 AND s.status='COMPLETED' AND s.currency='USD'
    AND (EXISTS(SELECT 1 FROM wl.payments p WHERE p.booking_id=$1 AND p.provider='square' AND p.metadata->>'square_environment'=s.environment
      AND (p.external_id=s.payment_id OR (s.order_id<>'' AND p.metadata->>'square_order_id'=s.order_id)))
    OR EXISTS(SELECT 1 FROM wl.square_invoices i WHERE i.booking_id=$1 AND i.environment=s.environment AND i.order_id=s.order_id AND i.order_id<>''))`, [bookingId, environment])).rows[0];
  await updateJobTipTotal(q, bookingId, Number(totals.tips), "square");
}

export async function updateJobTipTotal(q: Query, bookingId: string, amount: number, source: "square" | "manual") {
  const booking = (await q<{ tip_cents: number; manual_tip_cents: number; square_tip_cents: number }>("SELECT tip_cents,manual_tip_cents,square_tip_cents FROM wl.bookings WHERE id=$1 FOR UPDATE", [bookingId])).rows[0];
  if (!booking) return;
  const total = amount + Number(source === "square" ? booking.manual_tip_cents : booking.square_tip_cents);
  if (total !== Number(booking.tip_cents)) {
    const assignments = (await q<{ id: string; tip_override_cents: number | null }>("SELECT id,tip_override_cents FROM wl.employee_job_assignments WHERE booking_id=$1 FOR UPDATE", [bookingId])).rows;
    const recipients = assignments.filter((a) => a.tip_override_cents !== null && Number(a.tip_override_cents) > 0);
    // An explicit sole recipient remains the recipient as tips arrive/refund.
    if (recipients.length === 1 && Number(recipients[0].tip_override_cents) === Number(booking.tip_cents))
      await q("UPDATE wl.employee_job_assignments SET tip_override_cents=CASE WHEN id=$2 THEN $3 ELSE 0 END WHERE booking_id=$1", [bookingId, recipients[0].id, total]);
    else await q("UPDATE wl.employee_job_assignments SET tip_override_cents=NULL WHERE booking_id=$1", [bookingId]);
  }
  const column = source === "square" ? "square_tip_cents" : "manual_tip_cents";
  await q(`UPDATE wl.bookings SET ${column}=$2,tip_cents=$3,updated_at=now() WHERE id=$1`, [bookingId, amount, total]);
}
/** Match every partial payment by authoritative order, not customer name or amount. */
export async function reconcileDetailInvoice(q: Query, p: SquareLedgerPayment) {
  if (p.status !== "COMPLETED" || p.currency !== "USD" || !p.order_id) return;
  const invoice = (
    await q<Saved>(
      "SELECT * FROM wl.square_invoices WHERE environment=$1 AND order_id=$2 FOR UPDATE",
      [p.environment, p.order_id],
    )
  ).rows[0];
  if (!invoice) return;
  const b = (
    await q<{ customer_id: string; deposit_cents: number }>(
      "SELECT customer_id,deposit_cents FROM wl.bookings WHERE id=$1 FOR UPDATE",
      [invoice.booking_id],
    )
  ).rows[0];
  const principal = Math.max(0, Number(p.amount_cents) - Number(p.tip_cents));
  await q(
    `INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,status,kind,provider,external_id,checkout_url,paid_at,refunded_cents,processor_fee_cents,payment_method,metadata,tip_cents)
 VALUES($1,$2,$3,$4,'paid','balance','square',$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
 ON CONFLICT(id) DO UPDATE SET amount_cents=$4,refunded_cents=$8,processor_fee_cents=$9,tip_cents=$12,status=CASE WHEN $8>=$4 AND $8>0 THEN 'refunded' WHEN $8>0 THEN 'partially_refunded' ELSE 'paid' END`,
    [
      invoicePaymentId(p.environment, p.payment_id),
      invoice.booking_id,
      b.customer_id,
      principal,
      p.payment_id,
      invoice.url,
      p.paid_at,
      Math.min(principal, Number(p.refunded_cents)),
      Math.max(0, Number(p.processor_fee_cents)),
      p.payment_method,
      JSON.stringify({
        square_environment: p.environment,
        square_order_id: p.order_id,
        square_invoice_id: invoice.invoice_id,
      }),
      Math.max(0, Number(p.tip_cents) - Math.max(0, Number(p.refunded_cents) - principal)),
    ],
  );
  const totals = (
    await q<{ paid: number; tips: number }>(
      "SELECT COALESCE(SUM(amount_cents-tip_cents-refunded_cents),0)::int paid,COALESCE(SUM(GREATEST(0,tip_cents-GREATEST(0,refunded_cents-(amount_cents-tip_cents)))),0)::int tips FROM wl.square_payments WHERE environment=$1 AND order_id=$2 AND status='COMPLETED' AND currency='USD'",
      [p.environment, p.order_id],
    )
  ).rows[0];
  await q(
    "UPDATE wl.bookings SET status=CASE WHEN status='new' AND $2>=deposit_cents THEN 'confirmed' ELSE status END,updated_at=now() WHERE id=$1",
    [invoice.booking_id, totals.paid],
  );
  await syncJobSquareTips(q, invoice.booking_id, p.environment);
  await q(
    "UPDATE wl.square_invoices SET status=$3,updated_at=now() WHERE booking_id=$1 AND environment=$2 AND retired_at IS NULL",
    [
      invoice.booking_id,
      p.environment,
      Number(totals.paid) >= Number(invoice.amount_cents)
        ? "PAID"
        : Number(totals.paid) > 0
          ? "PARTIALLY_PAID"
          : "UNPAID",
    ],
  );
}
import { createHash } from "node:crypto";
function invoicePaymentId(environment: string, id: string) {
  const hex = createHash("sha256")
    .update("detail-invoice:" + environment + ":" + id)
    .digest("hex");
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-4" +
    hex.slice(13, 16) +
    "-a" +
    hex.slice(17, 20) +
    "-" +
    hex.slice(20, 32)
  );
}
