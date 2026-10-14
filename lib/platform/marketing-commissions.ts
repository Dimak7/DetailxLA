import { randomUUID } from "node:crypto";
import { query, transaction, type Query } from "./db";
import { AppError } from "./auth";

import { marketingStreams } from "../marketing-streams";


export type CommissionInput = {
  status: string; first_completed_id: string | null; id: string;
  price_cents: number | null; collected_cents: number; refunded_cents: number;
  rate_bps: number; approved_basis_cents: number | null; paid_cents: number;
};
export function commissionAmounts(row: CommissionInput) {
  const firstJob = row.first_completed_id === row.id;
  const complete = row.status === "completed" && firstJob;
  // price_cents is the final service subtotal after discounts, without tax/tips.
  // Deduct every refund conservatively; never turn refunded tax/tips into commission.
  const basis = Math.max(0, Number(row.price_cents || 0) - Number(row.refunded_cents));
  const fullyCollected = row.price_cents !== null && Number(row.collected_cents) >= row.price_cents;
  const eligible = complete && fullyCollected;
  const approved = row.approved_basis_cents !== null;
  const earned = eligible ? Math.round(Math.min(basis, approved ? Number(row.approved_basis_cents) : basis) * row.rate_bps / 10000) : 0;
  return {
    basis_cents: basis, earned_cents: earned,
    due_cents: (approved ? earned : 0) - Number(row.paid_cents),
    state: Number(row.paid_cents) > earned ? "Adjustment required" : row.first_completed_id && !firstJob ? "Repeat customer — no commission" : row.status === "cancelled" || row.status === "no_show" ? "Not eligible" : !complete ? "Awaiting completion" : !fullyCollected ? "Awaiting full payment" : !approved ? "Ready for approval" : earned > Number(row.paid_cents) ? "Approved — unpaid" : "Settled",
    can_approve: eligible && !approved && earned > 0,
  };
}

const phoneKey = (alias: string) => `CASE WHEN regexp_replace(${alias}.phone,'[^0-9]','','g') ~ '^1[0-9]{10}$' THEN right(regexp_replace(${alias}.phone,'[^0-9]','','g'),10) ELSE regexp_replace(${alias}.phone,'[^0-9]','','g') END`;
export async function marketingCommissionRows(q?: Query, bookingId?: string) {
  const sql = `SELECT b.id,b.reference,b.booking_date,b.status,b.price_cents,b.service_name,b.completed_at,
    c.first_name||' '||c.last_name customer_name,a.lead_stream,a.source,a.campaign,
    CASE WHEN a.lead_stream='Dima Google · 25%' THEN 2500 ELSE 1000 END AS rate_bps,
    ap.basis_cents approved_basis_cents,ap.lead_stream approved_stream,ap.rate_bps approved_rate_bps,
    (SELECT first.id FROM wl.bookings first JOIN wl.customers fc ON fc.id=first.customer_id
     WHERE first.status='completed' AND (first.customer_id=b.customer_id OR lower(fc.email)=lower(c.email)
       OR (length(${phoneKey('c')})>=10 AND ${phoneKey('fc')}=${phoneKey('c')}))
     ORDER BY COALESCE(first.completed_at,first.booking_date::date::timestamptz),first.created_at,first.id LIMIT 1) first_completed_id,
    COALESCE((SELECT SUM(p.amount_cents-p.tip_cents) FROM wl.revenue_payments p WHERE p.booking_id=b.id AND p.status IN ('paid','partially_refunded','refunded')),0)::bigint collected_cents,
    COALESCE((SELECT SUM(p.refunded_cents) FROM wl.revenue_payments p WHERE p.booking_id=b.id AND p.status IN ('paid','partially_refunded','refunded')),0)::bigint refunded_cents,
    COALESCE((SELECT SUM(mp.amount_cents) FROM wl.marketing_commission_payouts mp WHERE mp.booking_id=b.id),0)::bigint paid_cents
    FROM wl.bookings b JOIN wl.customers c ON c.id=b.customer_id
    LEFT JOIN wl.attributions a ON a.id=b.attribution_id
    LEFT JOIN wl.marketing_commission_approvals ap ON ap.booking_id=b.id
    WHERE (a.lead_stream=ANY($1::text[]) OR ap.booking_id IS NOT NULL)
      AND ($2::uuid IS NULL OR b.id=$2) ORDER BY b.created_at DESC,b.id`;
  const params = [marketingStreams.map((stream) => stream.name), bookingId || null];
  const result = q ? (await q<Record<string, unknown>>(sql, params)).rows : await query<Record<string, unknown>>(sql, params);
  return result.map((r) => {
    const row = { ...r, rate_bps: Number(r.approved_rate_bps || r.rate_bps),
      lead_stream: String(r.approved_stream || r.lead_stream),
      price_cents: r.price_cents === null ? null : Number(r.price_cents),
      collected_cents: Number(r.collected_cents), refunded_cents: Number(r.refunded_cents),
      approved_basis_cents: r.approved_basis_cents === null ? null : Number(r.approved_basis_cents), paid_cents: Number(r.paid_cents),
    } as unknown as CommissionInput & { reference: string; booking_date: string; completed_at: string | null; service_name: string; customer_name: string; lead_stream: string; source: string; campaign: string };
    return { ...row, ...commissionAmounts(row) };
  });
}
export async function marketingCommissionAction(bookingId: string, actor: string, action: "approve" | "record_paid", reference: string) {
  return transaction(async (q) => {
    // Serialize against booking completion/price changes and simultaneous payout recording.
    await q("SELECT id FROM wl.schedule_guard WHERE id=1 FOR UPDATE");
    const row = (await marketingCommissionRows(q, bookingId))[0];
    if (!row) throw new AppError("Marketing booking not found.", 404);
    if (action === "approve") {
      if (!row.can_approve) throw new AppError("Only the first completed, fully paid job can be approved.");
      await q("INSERT INTO wl.marketing_commission_approvals(booking_id,lead_stream,rate_bps,basis_cents,approved_by) VALUES($1,$2,$3,$4,$5)", [bookingId,row.lead_stream,row.rate_bps,row.basis_cents,actor]);
    } else {
      if (row.approved_basis_cents === null || row.due_cents <= 0) throw new AppError("There is no approved unpaid commission for this booking.");
      if (!reference.trim()) throw new AppError("Enter the transfer or payment reference.");
      await q("INSERT INTO wl.marketing_commission_payouts(id,booking_id,amount_cents,reference,recorded_by) VALUES($1,$2,$3,$4,$5)",[randomUUID(),bookingId,row.due_cents,reference.trim(),actor]);
    }
    await q("INSERT INTO wl.timeline(id,customer_id,booking_id,type,body,actor_id) SELECT $1,customer_id,id,'marketing_commission',$3,$4 FROM wl.bookings WHERE id=$2",[randomUUID(),bookingId,action === "approve" ? `Approved ${row.rate_bps/100}% marketing commission on service subtotal ${row.basis_cents} cents, excluding tax and tips.` : `Recorded marketing commission paid: ${row.due_cents} cents. Reference: ${reference.trim()}`,actor]);
    return { ok: true };
  });
}
