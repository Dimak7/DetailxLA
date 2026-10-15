import type { Query } from "../platform/db";
import type { SquareLedgerPayment } from "./square-reporting";
type Saved = {
  booking_id: string;
  invoice_id: string;
  url: string;
  amount_cents: number;
};
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
    `INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,status,kind,provider,external_id,checkout_url,paid_at,refunded_cents,processor_fee_cents,payment_method,metadata)
 VALUES($1,$2,$3,$4,'paid','balance','square',$5,$6,$7,$8,$9,$10,$11::jsonb)
 ON CONFLICT(id) DO UPDATE SET amount_cents=$4,refunded_cents=$8,processor_fee_cents=$9,status=CASE WHEN $8>=$4 THEN 'refunded' WHEN $8>0 THEN 'partially_refunded' ELSE 'paid' END`,
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
    ],
  );
  const totals = (
    await q<{ paid: number; tips: number }>(
      "SELECT COALESCE(SUM(amount_cents-tip_cents-refunded_cents),0)::int paid,COALESCE(SUM(GREATEST(0,tip_cents-GREATEST(0,refunded_cents-(amount_cents-tip_cents)))),0)::int tips FROM wl.square_payments WHERE environment=$1 AND order_id=$2 AND status='COMPLETED' AND currency='USD'",
      [p.environment, p.order_id],
    )
  ).rows[0];
  await q(
    "UPDATE wl.employee_job_assignments SET tip_override_cents=NULL WHERE booking_id=$1 AND (SELECT tip_cents FROM wl.bookings WHERE id=$1)<>$2+(SELECT manual_tip_cents FROM wl.bookings WHERE id=$1)",
    [invoice.booking_id, totals.tips],
  );
  await q(
    "UPDATE wl.bookings SET status=CASE WHEN status='new' AND $2>=deposit_cents THEN 'confirmed' ELSE status END,square_tip_cents=$3,tip_cents=manual_tip_cents+$3,updated_at=now() WHERE id=$1",
    [invoice.booking_id, totals.paid, totals.tips],
  );
  await q(
    "UPDATE wl.square_invoices SET status=$3,updated_at=now() WHERE booking_id=$1 AND environment=$2",
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
