import { query } from "./db";
import { paymentProvider } from "./settings";
import { squareEnvironment } from "../integrations/square-reporting";

export type BookingReceipt = {
  id: string;
  reference: string;
  status: "new" | "confirmed" | "in_progress" | "completed" | "cancelled" | "no_show";
  serviceName: string;
  lineItems?: Array<{ id: string; name: string; quantity: number; totalCents: number | null }>;
  vehicle: string;
  date: string;
  startMinute: number;
  location: string;
  priceCents: number | null;
  discountCents?: number;
  depositCents: number;
  /** Verified collections remaining after refunds, used for the outstanding balance. */
  paidCents: number;
  refundedCents: number;
  provider: "square" | "stripe" | null;
  payments: Array<{ id: string; amount_cents: number }>;
  pendingPayment: boolean;
  /** Exact existing checkout, only when its amount still matches the unpaid target. */
  pendingCheckoutUrl?: string | null;
  failedPayment: boolean;
  quoteBased: boolean;
};

type ReceiptRow = {
  id: string;
  reference: string;
  status: BookingReceipt["status"];
  service_name: string;
  vehicle: string;
  booking_date: string;
  start_minute: number;
  location: string;
  price_cents: number | null;
  discount_cents: number;
  deposit_cents: number;
  quote_based: boolean;
  line_items: NonNullable<BookingReceipt["lineItems"]>;
  payment_rows: Array<{
    id: string;
    status: string;
    provider: string;
    kind: string;
    amount_cents: number;
    refunded_cents: number;
    checkout_issued: boolean;
    checkout_url: string;
  }>;
};

function safeCheckoutUrl(value: string, provider: string, environment: string): string | null {
  if (!value || /[\s\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const hosts = provider === "square"
      ? environment === "sandbox" ? ["sandbox.square.link"] : ["square.link","checkout.square.site"]
      : provider === "stripe" ? ["checkout.stripe.com"] : [];
    return hosts.includes(url.hostname) ? value : null;
  } catch {
    return null;
  }
}

/** Private receipt data only. Callers must authenticate the receipt token before exposing it. */
export async function bookingReceipt(id: string): Promise<BookingReceipt | null> {
  const environment = squareEnvironment();
  const [rows, provider] = await Promise.all([
    query<ReceiptRow>(
      `SELECT b.id,b.reference,b.status,b.service_name,b.booking_date,b.start_minute,b.location,
        b.price_cents,b.deposit_cents,v.year||' '||v.make||' '||v.model vehicle,
        COALESCE((SELECT SUM(amount_cents) FROM wl.booking_discounts WHERE booking_id=b.id),0)::int discount_cents,
        COALESCE(b.price_cents IS NULL OR b.service_snapshot->>'pricing_mode'='quote'
          OR b.service_snapshot->>'slug'='ceramic-coating'
          OR b.service_snapshot->>'requires_quote'='true'
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(b.service_snapshot->'selected_services','[]'::jsonb)) selected
            WHERE selected->>'pricing_mode'='quote' OR selected->>'slug'='ceramic-coating'),false) quote_based,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id',li.id,'name',li.name,'quantity',li.quantity,'totalCents',CASE WHEN li.quote_pending THEN NULL WHEN b.price_cents IS NULL AND li.kind='base_service'
            AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(b.service_snapshot->'selected_services','[]'::jsonb)) selected
              WHERE selected->>'id'=li.service_id::text AND selected->>'base_cents' IS NULL)
            THEN NULL ELSE li.quantity*li.unit_price_cents END
          ) ORDER BY CASE WHEN li.kind='base_service' THEN 0 ELSE 1 END,li.created_at,li.name,li.id) FROM wl.booking_line_items li WHERE li.booking_id=b.id),'[]'::jsonb) line_items,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id',p.id,'status',p.status,'provider',p.provider,'kind',p.kind,
          'amount_cents',p.amount_cents,'refunded_cents',p.refunded_cents,'checkout_url',p.checkout_url,
          'checkout_issued',NULLIF(p.checkout_url,'') IS NOT NULL
            OR NULLIF(p.metadata->>'square_order_id','') IS NOT NULL
            OR NULLIF(p.stripe_session_id,'') IS NOT NULL
        ) ORDER BY p.created_at DESC,p.id DESC) FROM wl.payments p WHERE p.booking_id=b.id
          AND (p.provider<>'square' OR p.metadata->>'square_environment'=$2)), '[]'::jsonb) payment_rows
       FROM wl.bookings b JOIN wl.vehicles v ON v.id=b.vehicle_id WHERE b.id=$1`,
      [id,environment],
    ),
    paymentProvider(),
  ]);
  const row = rows[0];
  if (!row) return null;
  const captured = row.payment_rows.filter((payment) => ["paid","partially_refunded","refunded"].includes(payment.status));
  const latest = row.payment_rows[0];
  const paidCents = captured.reduce((sum,payment) => sum + Number(payment.amount_cents) - Number(payment.refunded_cents),0);
  const refundedCents = captured.reduce((sum,payment) => sum + Number(payment.refunded_cents),0);
  const target = latest?.kind === "deposit" ? Number(row.deposit_cents) : latest?.kind === "balance" ? row.price_cents : null;
  const owed = target === null ? 0 : Math.max(0,Number(target) - paidCents);
  const canResume = latest?.status === "pending" && latest.checkout_issued
    && row.price_cents !== null && !["cancelled","no_show"].includes(row.status)
    && !(row.status === "new" && row.quote_based && Number(row.deposit_cents) === 0)
    && row.payment_rows.every((payment) => Number(payment.refunded_cents) === 0)
    && owed > 0 && Number(latest.amount_cents) === owed
    && owed <= Math.max(0,Number(row.price_cents) - paidCents);
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    serviceName: row.service_name,
    lineItems: row.line_items.map((item) => ({ ...item, quantity: Number(item.quantity), totalCents: item.totalCents === null ? null : Number(item.totalCents) })),
    vehicle: row.vehicle,
    date: row.booking_date,
    startMinute: Number(row.start_minute),
    location: row.location,
    priceCents: row.price_cents === null ? null : Number(row.price_cents),
    discountCents: Number(row.discount_cents),
    depositCents: Number(row.deposit_cents),
    paidCents,
    refundedCents,
    provider,
    // Retain original capture values and stable IDs for conversion deduplication.
    // A fully refunded invoice must not create a fresh purchase conversion.
    payments: captured.filter((payment) => Number(payment.amount_cents) > Number(payment.refunded_cents))
      .map((payment) => ({id:payment.id,amount_cents:Number(payment.amount_cents)})),
    // Preparing an invoice happens before checkout creation. An orphaned pending
    // row must leave the retry action available instead of polling indefinitely.
    pendingPayment: latest?.status === "pending" && latest.checkout_issued,
    pendingCheckoutUrl: canResume ? safeCheckoutUrl(latest.checkout_url,latest.provider,environment) : null,
    failedPayment: latest?.status === "failed" || latest?.status === "expired",
    quoteBased: row.quote_based,
  };
}
