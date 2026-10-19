import { AppError, receiptToken } from "./auth";
import { query, transaction } from "./db";
import { bookingById } from "./bookings";
import { enqueue, enqueueBooking } from "./outbox";
import { secret, settings } from "./settings";
import { money } from "./types";
import { createCheckout, configuredPaymentProvider } from "../integrations/payments";
import { createSquareInvoice } from "../integrations/square-invoices";
import { squareEnvironment } from "../integrations/square-reporting";

async function smsRecipient(bookingId: string) {
  const b = await bookingById(bookingId);
  if (!b || ["cancelled", "no_show"].includes(b.status))
    throw new AppError("Choose an active appointment to send this text.");
  const business = await settings();
  if (!business.sms_from || !(await secret("sms_account")) || !(await secret("sms_token")))
    throw new AppError("Connect a Twilio number and credentials in Settings before sending texts.", 503);
  const customer = (await query<{ first_name: string; phone: string; sms_opted_out: boolean }>("SELECT first_name,phone,sms_opted_out FROM wl.customers WHERE id=$1 AND archived_at IS NULL", [b.customer_id]))[0];
  if (!customer?.phone || customer.sms_opted_out || (await query("SELECT id FROM wl.customers WHERE phone=$1 AND sms_opted_out LIMIT 1", [customer.phone])).length)
    throw new AppError("This customer has no phone number or has opted out of texts.");
  return { b, business, customer };
}

export async function sendBookingConfirmationText(bookingId: string, requestId: string) {
  const { b, business } = await smsRecipient(bookingId);
  if (b.status === "completed") throw new AppError("This appointment is already completed.");
  const token = await receiptToken(b.id);
  await transaction(q => enqueueBooking(q, b, business, token, b.status === "new" ? "booking_request" : "booking_confirmation", "staff-" + requestId, ["sms"]));
  return { queued: true };
}

export async function sendBookingPaymentText(bookingId: string, kind: "deposit" | "balance", requestId: string) {
  const { b, business, customer } = await smsRecipient(bookingId);
  if (kind === "deposit" && b.status === "completed") throw new AppError("The detail is complete. Send the remaining balance link instead.");
  if (b.price_cents === null) throw new AppError("Agree the quote before requesting payment.");
  const environment = squareEnvironment();
  const paid = Number((await query<{ paid: number }>("SELECT COALESCE(SUM(amount_cents-refunded_cents),0)::int paid FROM wl.payments WHERE booking_id=$1 AND status IN ('paid','partially_refunded','refunded') AND (provider<>'square' OR metadata->>'square_environment'=$2)", [b.id, environment]))[0].paid);
  const provider = await configuredPaymentProvider();
  const hasInvoice = (await query("SELECT booking_id FROM wl.square_invoices WHERE booking_id=$1 AND environment=$2", [b.id, environment])).length > 0;
  const hasCheckout = (await query("SELECT id FROM wl.payments WHERE booking_id=$1 AND status IN ('pending','paid','partially_refunded','refunded') AND (provider<>'square' OR COALESCE(metadata->>'square_environment','') IN ('',$2))", [b.id, environment])).length > 0;
  const useInvoice = provider === "square" && (hasInvoice || !hasCheckout);
  const target = kind === "deposit" ? (b.deposit_cents || (useInvoice ? Math.round(b.price_cents / 2) : 0)) : b.price_cents;
  const amount = Math.max(0, target - paid);
  if (!amount) throw new AppError(kind === "deposit" ? "The required deposit is already paid or no deposit is due." : "This appointment is already paid in full.");
  const url = useInvoice ? (await createSquareInvoice(b.id)).url : await createCheckout(b.id, kind);
  if (!url || new URL(url).protocol !== "https:") throw new AppError("A secure customer payment link could not be created.");
  await transaction(q => enqueue(q, {
    key: `${b.id}:payment-link:${kind}:${requestId}`, channel: "sms", recipient: customer.phone,
    body: `${business.name}: Hi ${customer.first_name}, your ${kind === "deposit" ? "deposit" : "remaining balance"} for booking ${b.reference} is ${money(amount)}. Pay securely: ${url}${kind === "deposit" ? " Your appointment is confirmed once the required deposit is received." : " Thank you!"}`,
    customerId: b.customer_id, bookingId: b.id,
  }));
  return { queued: true, url, amount_cents: amount };
}
