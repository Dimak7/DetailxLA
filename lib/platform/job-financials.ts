import { query } from "./db";
import type { Row } from "./types";

export async function jobFinancials(bookingId: string) {
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
  return { ...row, gross_service_cents: gross, net_service_cents: net, outstanding_cents: Math.max(0, net + Number(row.tip_cents) - Number(row.collected_cents)) };
}
