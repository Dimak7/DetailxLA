import { randomUUID } from "node:crypto";
import { AppError } from "../platform/auth";
import { query, transaction, type Query } from "../platform/db";
import { secret } from "../platform/settings";

export const SQUARE_API_VERSION = "2026-09-16";
export type SquareEnvironment = "production" | "sandbox";
export type SquareMoney = { amount?: number; currency?: string };
export type SquarePayment = {
  id?: string;
  location_id?: string;
  order_id?: string;
  status?: string;
  amount_money?: SquareMoney;
  total_money?: SquareMoney;
  tip_money?: SquareMoney;
  refunded_money?: SquareMoney;
  processing_fee?: Array<{ amount_money?: SquareMoney }>;
  source_type?: string;
  receipt_url?: string;
  created_at?: string;
  updated_at?: string;
  offline_payment_details?: { client_created_at?: string };
  card_details?: {
    card?: { card_brand?: string; last_4?: string };
    card_payment_timeline?: { captured_at?: string };
  };
};
export type SquareLedgerPayment = {
  environment: SquareEnvironment;
  payment_id: string;
  location_id: string;
  order_id: string;
  status: string;
  amount_cents: number | string;
  tip_cents: number | string;
  refunded_cents: number | string;
  processor_fee_cents: number | string;
  currency: string;
  source_type: string;
  payment_method: string;
  receipt_url: string;
  created_at: string | Date | null;
  updated_at: string | Date | null;
  paid_at: string | Date | null;
};
type SyncCursor = {
  locations: string[];
  locationIndex: number;
  paymentCursor: string;
  endTime: string;
  processed: number;
  lease: string;
  updatedBeginTime?: string;
  fullHistoryLocations: string[];
  knownLocations?: string[];
};
type SyncRow = { cursor: Partial<SyncCursor>; status: string; last_synced_at: string | Date | null; last_error: string };
export type SquareRevenueStatus = {
  configured: boolean;
  environment: SquareEnvironment;
  status: string;
  lastSyncedAt: string | null;
  lastError: string;
  hasMore: boolean;
  count: number;
};
export type SquareSyncResult = {
  environment: SquareEnvironment;
  complete: boolean;
  hasMore: boolean;
  count: number;
  processed: number;
  pages: number;
  busy: boolean;
};

export function squareEnvironment(): SquareEnvironment {
  return process.env.SQUARE_ENVIRONMENT?.toLowerCase() === "sandbox" ? "sandbox" : "production";
}
export function squareApiBase(environment = squareEnvironment()) {
  return environment === "sandbox" ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com";
}
function cents(value: number | undefined, signed = false) {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || (!signed && value < 0)) {
    throw new AppError("Square supplied an invalid payment amount.", 502);
  }
  return value;
}
function timestamp(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new AppError("Square supplied an invalid payment date.", 502);
  return date.toISOString();
}

export function normalizeSquarePayment(payment: SquarePayment, environment: SquareEnvironment): SquareLedgerPayment {
  if (!payment.id || !payment.status || (!payment.total_money && !payment.amount_money)) {
    throw new AppError("Square payment evidence is incomplete.", 502);
  }
  const tip = cents(payment.tip_money?.amount);
  const amount = cents(payment.total_money?.amount ?? cents(payment.amount_money?.amount) + tip);
  const currency = payment.total_money?.currency || payment.amount_money?.currency;
  if (!currency || !/^[A-Z]{3}$/.test(currency)) throw new AppError("Square payment currency is missing.", 502);
  for (const money of [payment.amount_money, payment.tip_money, payment.refunded_money, ...(payment.processing_fee || []).map((fee) => fee.amount_money)]) {
    if (money?.currency && money.currency !== currency) throw new AppError("Square payment currencies do not match.", 502);
  }
  const card = payment.card_details?.card;
  const createdAt = timestamp(payment.created_at);
  return {
    environment, payment_id: payment.id, location_id: payment.location_id || "", order_id: payment.order_id || "",
    status: payment.status, amount_cents: amount, tip_cents: tip,
    refunded_cents: cents(payment.refunded_money?.amount),
    // Fee adjustments may be negative. They are part of the authoritative total.
    processor_fee_cents: cents((payment.processing_fee || []).reduce((sum, fee) => sum + cents(fee.amount_money?.amount, true), 0), true),
    currency, source_type: payment.source_type || "",
    payment_method: card?.last_4 ? `${card.card_brand || "Card"} ending ${card.last_4}` : (payment.source_type || "Card").replaceAll("_", " "),
    receipt_url: payment.receipt_url || "", created_at: createdAt, updated_at: timestamp(payment.updated_at),
    paid_at: payment.status === "COMPLETED" ? timestamp(payment.card_details?.card_payment_timeline?.captured_at) || timestamp(payment.offline_payment_details?.client_created_at) || createdAt : null,
  };
}

/** Payment snapshots are cumulative, never additive, including refunds. */
export async function upsertSquarePayment(q: Query, payment: SquarePayment, environment: SquareEnvironment, options: { reconcileInvoice?: boolean } = {}) {
  const row = normalizeSquarePayment(payment, environment);
  // Missing/older timestamps cannot replace newer evidence or regress a terminal state.
  const fresh = `(current.updated_at IS NULL OR (EXCLUDED.updated_at IS NOT NULL AND EXCLUDED.updated_at >= current.updated_at))
    AND NOT (current.status='COMPLETED' AND EXCLUDED.status<>'COMPLETED')
    AND NOT (current.status IN ('CANCELED','FAILED') AND EXCLUDED.status IN ('PENDING','APPROVED'))`;
  const columns = Object.keys(row) as Array<keyof SquareLedgerPayment>;
  const replace = ["status", "amount_cents", "tip_cents", "processor_fee_cents", "currency", "payment_method"];
  const updates = replace.map((column) => `${column}=CASE WHEN ${fresh} THEN EXCLUDED.${column} ELSE current.${column} END`);
  for (const column of ["location_id", "order_id", "source_type", "receipt_url"]) {
    updates.push(`${column}=CASE WHEN ${fresh} THEN COALESCE(NULLIF(EXCLUDED.${column},''),current.${column}) ELSE current.${column} END`);
  }
  const saved = (await q<SquareLedgerPayment>(
    `INSERT INTO wl.square_payments AS current (${columns.join(",")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(",")})
     ON CONFLICT (environment,payment_id) DO UPDATE SET ${updates.join(",")},
       refunded_cents=GREATEST(current.refunded_cents,EXCLUDED.refunded_cents),
       created_at=COALESCE(current.created_at,EXCLUDED.created_at),
       updated_at=CASE WHEN ${fresh} THEN COALESCE(EXCLUDED.updated_at,current.updated_at) ELSE current.updated_at END,
       paid_at=${payment.card_details?.card_payment_timeline?.captured_at ? "COALESCE(EXCLUDED.paid_at,current.paid_at)" : "COALESCE(current.paid_at,EXCLUDED.paid_at)"},synced_at=now()
     RETURNING *`, columns.map((column) => row[column]),
  )).rows[0];
  // Only a unique trustworthy ID/order match earns website attribution. No POS
  // customer or appointment is created. Old untagged checkout rows can be linked.
  const matches = (await q<{ id: string }>(
    `SELECT id FROM wl.payments WHERE provider='square'
       AND (COALESCE(metadata->>'square_environment','') IN ('',$3))
       AND (external_id=$1 OR (COALESCE(external_id,'')='' AND $2<>'' AND metadata->>'square_order_id'=$2))
     FOR UPDATE`, [saved.payment_id, saved.order_id, environment],
  )).rows;
  if (matches.length === 1) {
    await q(`UPDATE wl.payments SET metadata=metadata||jsonb_build_object('square_environment',$2::text) WHERE id=$1`, [matches[0].id, environment]);
    if (options.reconcileInvoice && saved.status === "COMPLETED" && saved.currency === "USD") {
      const invoices = (await q<{ booking_id: string }>(`UPDATE wl.payments SET external_id=$2,
        paid_at=COALESCE(paid_at,$3::timestamptz),
        status=CASE WHEN GREATEST(refunded_cents,$4::bigint)>=amount_cents THEN 'refunded'
          WHEN GREATEST(refunded_cents,$4::bigint)>0 THEN 'partially_refunded' ELSE 'paid' END
        WHERE id=$1 AND amount_cents=$5::bigint RETURNING booking_id`,
      [matches[0].id, saved.payment_id, saved.paid_at, saved.refunded_cents, Number(saved.amount_cents) - Number(saved.tip_cents)])).rows;
      if (invoices[0]) await q("UPDATE wl.bookings SET status='confirmed',updated_at=now() WHERE id=$1 AND status='new'", [invoices[0].booking_id]);
    }
    // Reconciliation never adds a refund twice; confirmation still belongs to
    // the signed booking webhook flow.
    await q(`UPDATE wl.payments SET refunded_cents=LEAST(amount_cents,GREATEST(refunded_cents,$2::bigint)),
      processor_fee_cents=GREATEST(0,$3::bigint),
      status=CASE WHEN $2::bigint>=amount_cents AND $2::bigint>0 THEN 'refunded' WHEN $2::bigint>0 THEN 'partially_refunded' ELSE status END
      WHERE id=$1 AND status IN ('paid','partially_refunded','refunded')`,
    [matches[0].id, saved.refunded_cents, saved.processor_fee_cents]);
  }
  return saved;
}

async function squareGet<T>(path: string, token: string, environment: SquareEnvironment): Promise<T> {
  try {
    const response = await fetch(squareApiBase(environment) + path, {
      method: "GET", headers: { Authorization: "Bearer " + token, "Square-Version": SQUARE_API_VERSION },
      signal: AbortSignal.timeout(15000), cache: "no-store",
    });
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw new AppError("Square access was denied. Check the access token and read permissions.", 502);
      if (response.status === 429) throw new AppError("Square is temporarily rate limited. Retry the sync shortly.", 502);
      throw new AppError("Square could not return payment data. Retry the sync.", 502);
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Square could not be reached or its response was invalid. Retry the sync.", 502);
  }
}
export async function retrieveSquarePayment(paymentId: string, environment = squareEnvironment()) {
  const token = await secret("square_access_token");
  if (!token) throw new AppError("Square reporting is not configured.", 503);
  const result = await squareGet<{ payment?: SquarePayment }>("/v2/payments/" + encodeURIComponent(paymentId), token, environment);
  if (!result.payment || result.payment.id !== paymentId) throw new AppError("Square payment evidence is incomplete.", 502);
  return result.payment;
}

export async function squareRevenueStatus(): Promise<SquareRevenueStatus> {
  const environment = squareEnvironment();
  const [token, rows, counts] = await Promise.all([
    secret("square_access_token"),
    query<SyncRow>("SELECT cursor,status,last_synced_at,last_error FROM wl.square_sync WHERE environment=$1", [environment]),
    query<{ count: string }>("SELECT COUNT(*)::text count FROM wl.square_payments WHERE environment=$1", [environment]),
  ]);
  const row = rows[0];
  return {
    configured: Boolean(token), environment, status: row?.status || "idle",
    lastSyncedAt: row?.last_synced_at ? new Date(row.last_synced_at).toISOString() : null,
    lastError: row?.last_error || "", hasMore: Boolean(row?.cursor?.locations), count: Number(counts[0]?.count || 0),
  };
}

/** Bounded GET-only batches; the persisted cursor always exposes unfinished history. */
export async function syncSquarePayments(options: { maxPages?: number } = {}): Promise<SquareSyncResult> {
  const environment = squareEnvironment();
  const token = await secret("square_access_token");
  if (!token) throw new AppError("Square reporting is not configured.", 503);
  const maxPages = Math.max(1, Math.min(8, Math.floor(options.maxPages || 4)));
  const lease = randomUUID();
  const claimed = await transaction(async (q) => {
    await q("INSERT INTO wl.square_sync(environment) VALUES($1) ON CONFLICT DO NOTHING", [environment]);
    return (await q<SyncRow>(`UPDATE wl.square_sync SET status='syncing',last_error='',updated_at=now(),
      cursor=cursor||jsonb_build_object('lease',$2::text)
      WHERE environment=$1 AND (status<>'syncing' OR updated_at<now()-interval '2 minutes')
      RETURNING cursor,status,last_synced_at,last_error`, [environment, lease])).rows[0];
  });
  let processed = 0, pages = 0;
  const result = async (complete: boolean, busy = false): Promise<SquareSyncResult> => ({
    environment, complete, hasMore: !complete, count: (await squareRevenueStatus()).count, processed, pages, busy,
  });
  if (!claimed) return result(false, true);
  try {
    let cursor: SyncCursor;
    if (Array.isArray(claimed.cursor.locations) && claimed.cursor.endTime) {
      cursor = { locations: claimed.cursor.locations, locationIndex: claimed.cursor.locationIndex || 0,
        paymentCursor: claimed.cursor.paymentCursor || "", endTime: claimed.cursor.endTime,
        processed: claimed.cursor.processed || 0, lease, updatedBeginTime: claimed.cursor.updatedBeginTime,
        fullHistoryLocations: claimed.cursor.fullHistoryLocations || claimed.cursor.locations };
    } else {
      const locations = await squareGet<{ locations?: Array<{ id?: string }> }>("/v2/locations", token, environment);
      if (!Array.isArray(locations.locations) || locations.locations.some((location) => !location.id)) {
        throw new AppError("Square returned an incomplete location list. Retry the sync.", 502);
      }
      const ids = [...new Set(locations.locations.map((location) => location.id!))];
      const known = claimed.cursor.knownLocations || [];
      cursor = { locations: ids, locationIndex: 0,
        paymentCursor: "", endTime: new Date().toISOString(), processed: 0, lease,
        fullHistoryLocations: ids.filter((id) => !known.includes(id)),
        updatedBeginTime: claimed.last_synced_at ? new Date(new Date(claimed.last_synced_at).getTime() - 48 * 3600000).toISOString() : undefined };
    }
    const started = Date.now();
    while (cursor.locationIndex < cursor.locations.length && pages < maxPages && Date.now() - started < 40000) {
      const params = new URLSearchParams({ begin_time: "1970-01-01T00:00:00Z", end_time: cursor.endTime,
        sort_order: "ASC", sort_field: "UPDATED_AT", updated_at_end_time: cursor.endTime,
        limit: "100", location_id: cursor.locations[cursor.locationIndex] });
      if (cursor.updatedBeginTime && !cursor.fullHistoryLocations.includes(cursor.locations[cursor.locationIndex])) {
        params.set("updated_at_begin_time", cursor.updatedBeginTime);
      }
      if (cursor.paymentCursor) params.set("cursor", cursor.paymentCursor);
      const page = await squareGet<{ payments?: SquarePayment[]; cursor?: string }>("/v2/payments?" + params, token, environment);
      if (page.payments !== undefined && !Array.isArray(page.payments)) throw new AppError("Square returned an invalid payment page.", 502);
      if (page.cursor && page.cursor === cursor.paymentCursor) throw new AppError("Square pagination did not advance. Retry the sync.", 502);
      const payments = page.payments || [];
      const next = { ...cursor, paymentCursor: page.cursor || "", processed: cursor.processed + payments.length };
      if (!page.cursor) next.locationIndex++;
      const saved = await transaction(async (q) => {
        const owned = (await q(`SELECT environment FROM wl.square_sync WHERE environment=$1 AND cursor->>'lease'=$2 FOR UPDATE`, [environment, lease])).rows.length;
        if (!owned) return false;
        for (const payment of payments) await upsertSquarePayment(q, payment, environment, { reconcileInvoice: true });
        await q("UPDATE wl.square_sync SET cursor=$2::jsonb,updated_at=now() WHERE environment=$1", [environment, JSON.stringify(next)]);
        return true;
      });
      if (!saved) return result(false, true);
      cursor = next;
      processed += payments.length;
      pages++;
    }
    const complete = cursor.locationIndex >= cursor.locations.length;
    await query(`UPDATE wl.square_sync SET cursor=$3::jsonb,status=$4,last_error='',updated_at=now(),
      last_synced_at=CASE WHEN $4='complete' THEN $5::timestamptz ELSE last_synced_at END
      WHERE environment=$1 AND cursor->>'lease'=$2`,
    [environment, lease, JSON.stringify(complete ? { knownLocations: cursor.locations } : cursor), complete ? "complete" : "partial", cursor.endTime]);
    return result(complete);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Square sync could not be completed. Retry the sync.";
    await query("UPDATE wl.square_sync SET status='error',last_error=$3,updated_at=now() WHERE environment=$1 AND cursor->>'lease'=$2", [environment, lease, message]);
    throw new AppError(message, 502);
  }
}
