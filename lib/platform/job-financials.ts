import { query } from "./db";
import type { Row } from "./types";

export type JobFinancials = {
  id: string;
  price_cents: number;
  tip_cents: number;
  base_service_cents: number;
  upsell_cents: number;
  discount_cents: number;
  collected_cents: number;
  gross_service_cents: number;
  net_service_cents: number;
  outstanding_cents: number;
};

export async function jobFinancials(bookingId: string): Promise<JobFinancials | null> {
  const rows = await query<Row>(`SELECT b.id,b.price_cents,b.tip_cents,
    COALESCE((SELECT SUM(quantity*unit_price_cents) FROM wl.booking_line_items WHERE booking_id=b.id AND kind='base_service'),b.price_cents,0)::int base_service_cents,
    COALESCE((SELECT SUM(quantity*unit_price_cents) FROM wl.booking_line_items WHERE booking_id=b.id AND kind='upsell'),0)::int upsell_cents,
    COALESCE((SELECT SUM(amount_cents) FROM wl.booking_discounts WHERE booking_id=b.id),0)::int discount_cents,
    COALESCE((SELECT SUM(amount_cents-refunded_cents) FROM wl.payments WHERE booking_id=b.id AND status IN ('paid','partially_refunded','refunded')),0)::int collected_cents
    FROM wl.bookings b WHERE b.id=$1`, [bookingId]);
  const row = rows[0];
  if (!row) return null;
  const gross = Number(row.base_service_cents) + Number(row.upsell_cents);
  const net = Math.max(0, gross - Number(row.discount_cents));
  return {
    id: String(row.id),
    price_cents: Number(row.price_cents || 0),
    tip_cents: Number(row.tip_cents || 0),
    base_service_cents: Number(row.base_service_cents || 0),
    upsell_cents: Number(row.upsell_cents || 0),
    discount_cents: Number(row.discount_cents || 0),
    collected_cents: Number(row.collected_cents || 0),
    gross_service_cents: gross,
    net_service_cents: net,
    outstanding_cents: Math.max(0, net + Number(row.tip_cents) - Number(row.collected_cents)),
  };
}
