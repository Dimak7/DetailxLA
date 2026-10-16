import { randomUUID } from "node:crypto";
import { query, transaction, type Query } from "../platform/db";
import { AppError } from "../platform/auth";
import { secret } from "../platform/settings";
import { dateToday } from "../platform/types";
import {
  SQUARE_API_VERSION,
  squareApiBase,
  squareEnvironment,
  upsertSquarePayment,
  type SquarePayment,
  type SquareLedgerPayment,
} from "./square-reporting";

type Invoice = {
  id: string;
  version: number;
  status: string;
  public_url?: string;
  order_id: string;
};
type Saved = {
  booking_id: string;
  environment: string;
  request_id: string;
  customer_id: string;
  order_id: string;
  invoice_id: string;
  url: string;
  amount_cents: number;
  status: string;
};
async function api<T>(path: string, body?: unknown): Promise<T> {
  const token = await secret("square_access_token");
  if (!token)
    throw new AppError("Connect Square before creating an invoice.", 503);
  const response = await fetch(squareApiBase() + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Square-Version": SQUARE_API_VERSION,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok)
    throw new AppError(
      result.errors?.[0]?.detail ||
        "Square invoice request failed. Check Square permissions and retry.",
      502,
    );
  return result as T;
}
/** One recoverable, idempotent customer/order/invoice chain per appointment. Never charges a card. */
export async function createSquareInvoice(bookingId: string) {
  const environment = squareEnvironment(),
    location = await secret("square_location_id");
  if (!location) throw new AppError("Connect the Square location first.", 503);
  const saved = await transaction(async (q) => {
    const b = (
      await q<{
        id: string;
        price_cents: number | null;
        status: string;
        booking_date: string;
      }>("SELECT * FROM wl.bookings WHERE id=$1 FOR UPDATE", [bookingId])
    ).rows[0];
    if (
      !b ||
      ["cancelled", "no_show"].includes(b.status) ||
      b.price_cents === null ||
      Number(b.price_cents) < 2
    )
      throw new AppError(
        "Agree a positive service price before creating the invoice.",
      );
    if ((await q("SELECT id FROM wl.booking_line_items WHERE booking_id=$1 AND quote_pending LIMIT 1", [bookingId])).rows.length)
      throw new AppError("Agree a price for every quoted upgrade before creating the invoice.");
    const existing = (
      await q<Saved>(
        "SELECT * FROM wl.square_invoices WHERE booking_id=$1 AND environment=$2",
        [bookingId, environment],
      )
    ).rows[0];
    if (existing) return existing;
    if (
      (
        await q(
          "SELECT id FROM wl.payments WHERE booking_id=$1 AND status IN ('pending','paid','partially_refunded','refunded') AND (provider<>'square' OR COALESCE(metadata->>'square_environment','') IN ('',$2))",
          [bookingId, environment],
        )
      ).rows.length
    )
      throw new AppError(
        "This booking already has a payment or checkout. Finish its existing collection flow instead of creating a second invoice.",
      );
    await q("UPDATE wl.bookings SET deposit_cents=$2 WHERE id=$1", [
      bookingId,
      Math.round(Number(b.price_cents) / 2),
    ]);
    return (
      await q<Saved>(
        "INSERT INTO wl.square_invoices(booking_id,environment,request_id,amount_cents) VALUES($1,$2,$3,$4) RETURNING *",
        [bookingId, environment, randomUUID(), b.price_cents],
      )
    ).rows[0];
  });
  if (saved.url) return { url: saved.url };
  const b = (
    await query<{
      reference: string;
      service_name: string;
      booking_date: string;
      first_name: string;
      last_name: string;
      email: string;
      phone: string;
      vehicle: string;
    }>(
      "SELECT b.*,c.first_name,c.last_name,c.email,c.phone,v.year||' '||v.make||' '||v.model vehicle FROM wl.bookings b JOIN wl.customers c ON c.id=b.customer_id JOIN wl.vehicles v ON v.id=b.vehicle_id WHERE b.id=$1",
      [bookingId],
    )
  )[0];
  if (!saved.customer_id) {
    const result = await api<{ customer: { id: string } }>("/v2/customers", {
      idempotency_key: saved.request_id + "-c",
      given_name: b.first_name,
      family_name: b.last_name,
      email_address: b.email || undefined,
      phone_number: b.phone || undefined,
      reference_id: bookingId,
    });
    saved.customer_id = result.customer.id;
    await query(
      "UPDATE wl.square_invoices SET customer_id=$3 WHERE booking_id=$1 AND environment=$2",
      [bookingId, environment, saved.customer_id],
    );
  }
  if (!saved.order_id) {
    const result = await api<{ order: { id: string } }>("/v2/orders", {
      idempotency_key: saved.request_id + "-o",
      order: {
        location_id: location,
        customer_id: saved.customer_id,
        reference_id: b.reference,
        line_items: [
          {
            name: b.service_name.slice(0, 240),
            quantity: "1",
            note: b.reference + " · " + b.vehicle,
            base_price_money: {
              amount: Number(saved.amount_cents),
              currency: "USD",
            },
          },
        ],
      },
    });
    saved.order_id = result.order.id;
    await query(
      "UPDATE wl.square_invoices SET order_id=$3 WHERE booking_id=$1 AND environment=$2",
      [bookingId, environment, saved.order_id],
    );
  }
  let invoice: Invoice;
  if (!saved.invoice_id) {
    const today = dateToday(),
      due = b.booking_date < today ? today : b.booking_date;
    const result = await api<{ invoice: Invoice }>("/v2/invoices", {
      idempotency_key: saved.request_id + "-i",
      invoice: {
        location_id: location,
        order_id: saved.order_id,
        primary_recipient: { customer_id: saved.customer_id },
        title: "Detail · " + b.reference,
        description:
          b.service_name +
          " · " +
          b.vehicle +
          ". 50% deposit to reserve; remaining balance due when detailing is complete, before vehicle handover.",
        delivery_method: "SHARE_MANUALLY",
        accepted_payment_methods: { card: true },
        sale_or_service_date: b.booking_date,
        payment_requests: [
          {
            request_type: "DEPOSIT",
            due_date: today,
            fixed_amount_requested_money: {
              amount: Math.round(Number(saved.amount_cents) / 2),
              currency: "USD",
            },
            automatic_payment_source: "NONE",
          },
          {
            request_type: "BALANCE",
            due_date: due,
            tipping_enabled: true,
            automatic_payment_source: "NONE",
          },
        ],
      },
    });
    invoice = result.invoice;
    saved.invoice_id = invoice.id;
    await query(
      "UPDATE wl.square_invoices SET invoice_id=$3 WHERE booking_id=$1 AND environment=$2",
      [bookingId, environment, invoice.id],
    );
  } else
    invoice = (
      await api<{ invoice: Invoice }>(
        "/v2/invoices/" + encodeURIComponent(saved.invoice_id),
      )
    ).invoice;
  if (invoice.status === "DRAFT")
    invoice = (
      await api<{ invoice: Invoice }>(
        "/v2/invoices/" + encodeURIComponent(invoice.id) + "/publish",
        { version: invoice.version, idempotency_key: saved.request_id + "-p" },
      )
    ).invoice;
  if (!invoice.public_url)
    throw new AppError(
      "Square has not made the invoice available. Retry or review it in Square.",
      502,
    );
  await query(
    "UPDATE wl.square_invoices SET url=$3,status=$4,updated_at=now() WHERE booking_id=$1 AND environment=$2",
    [bookingId, environment, invoice.public_url, invoice.status],
  );
  return { url: invoice.public_url };
}

export async function refreshDetailInvoice(bookingId: string) {
  const invoice = (
    await query<Saved>(
      "SELECT * FROM wl.square_invoices WHERE booking_id=$1 AND environment=$2",
      [bookingId, squareEnvironment()],
    )
  )[0];
  if (!invoice?.invoice_id)
    throw new AppError("Create the Square invoice first.");
  const result = await api<{
    order: { tenders?: Array<{ payment_id?: string }> };
  }>("/v2/orders/" + encodeURIComponent(invoice.order_id));
  for (const tender of result.order.tenders || []) {
    if (!tender.payment_id) continue;
    const evidence = await api<{ payment: SquarePayment }>(
      "/v2/payments/" + encodeURIComponent(tender.payment_id),
    );
    if (evidence.payment.order_id !== invoice.order_id)
      throw new AppError("Square payment order mismatch.", 502);
    await transaction((q) =>
      upsertSquarePayment(q, evidence.payment, squareEnvironment()),
    );
  }
  return { refreshed: true };
}
