import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { query, transaction } from "../platform/db";
import { AppError, receiptToken } from "../platform/auth";
import { secret, settings, siteUrl } from "../platform/settings";
import { bookingById } from "../platform/bookings";
import { enqueue, enqueueBooking } from "../platform/outbox";
import { metaEvent } from "./providers";
import type { Booking } from "../platform/types";
export async function createCheckout(
  bookingId: string,
  kind: "deposit" | "balance" = "balance",
) {
  const key = await secret("stripe_key");
  if (!key)
    throw new AppError(
      "Payments are not connected. Please contact the spa.",
      503,
    );
  const b = await bookingById(bookingId);
  if (!b || ["cancelled", "no_show"].includes(b.status))
    throw new AppError("This appointment cannot be paid online.");
  if (b.price_cents == null)
    throw new AppError("A quote must be agreed before creating an invoice.");
  const p = await transaction(async (q) => {
    const current = (
      await q<Booking>("SELECT * FROM wl.bookings WHERE id=$1 FOR UPDATE", [
        bookingId,
      ])
    ).rows[0];
    if (
      current.price_cents == null ||
      ["cancelled", "no_show"].includes(current.status)
    )
      throw new AppError("This appointment cannot be paid online.");
    const paid = (
      await q<{ amount: number }>(
        "SELECT COALESCE(SUM(amount_cents-refunded_cents),0)::int amount FROM wl.payments WHERE booking_id=$1 AND status IN ('paid','partially_refunded','refunded')",
        [bookingId],
      )
    ).rows[0].amount;
    const owed = Math.max(
      0,
      (kind === "deposit" ? current.deposit_cents : current.price_cents) - paid,
    );
    if (!owed)
      throw new AppError("There is no outstanding amount for this payment.");
    const old = (
      await q<{ id: string; amount_cents: number; checkout_url: string }>(
        "SELECT * FROM wl.payments WHERE booking_id=$1 AND status='pending' ORDER BY created_at LIMIT 1",
        [bookingId],
      )
    ).rows[0];
    if (old) return old;
    return (
      await q<{ id: string; amount_cents: number; checkout_url: string }>(
        "INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,kind) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [randomUUID(), bookingId, b.customer_id, owed, kind],
      )
    ).rows[0];
  });
  if (p.checkout_url) return p.checkout_url;
  const token = await receiptToken(b.id),
    url = siteUrl() + "/booking/confirmation?id=" + b.id + "&token=" + token;
  const stripe = new Stripe(key, { timeout: 15000, maxNetworkRetries: 1 });
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      customer_email: b.email,
      success_url: url + "&payment=returned",
      cancel_url: url + "&payment=cancelled",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: p.amount_cents,
            product_data: {
              name: (await settings()).name + " - " + b.service_name,
            },
          },
        },
      ],
      metadata: { payment_id: p.id, booking_id: b.id },
      payment_intent_data: { metadata: { payment_id: p.id, booking_id: b.id } },
    },
    { idempotencyKey: "wl-payment-" + p.id },
  );
  if (!session.url)
    throw new AppError("Payment link could not be created.", 502);
  await query(
    "UPDATE wl.payments SET stripe_session_id=$2,checkout_url=$3 WHERE id=$1",
    [p.id, session.id, session.url],
  );
  return session.url;
}
export async function verifyStripeEvent(body: string, signature: string) {
  const key = await secret("stripe_key"),
    webhook = await secret("stripe_webhook");
  if (!key || !webhook)
    throw new AppError("Stripe webhook is not configured.", 503);
  try {
    return new Stripe(key).webhooks.constructEvent(body, signature, webhook);
  } catch {
    throw new AppError("Invalid payment signature.", 400);
  }
}
export async function handleStripeEvent(event: Stripe.Event) {
  const s = await settings();
  const object = event.data.object;
  const session = object as Stripe.Checkout.Session;
  const paymentId = session.metadata?.payment_id;
  const bId = session.metadata?.booking_id;
  const token = bId ? await receiptToken(bId) : "";
  await transaction(async (q) => {
    const inserted = (
      await q(
        "INSERT INTO wl.webhooks(id,provider) VALUES($1,'stripe') ON CONFLICT DO NOTHING RETURNING id",
        [event.id],
      )
    ).rows;
    if (!inserted.length) return;
    if (
      [
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
      ].includes(event.type)
    ) {
      if (session.payment_status !== "paid" || !paymentId) return;
      await q("SELECT id FROM wl.bookings WHERE id=$1 FOR UPDATE", [bId]);
      const p = (
        await q<{
          id: string;
          booking_id: string;
          customer_id: string;
          amount_cents: number;
          status: string;
        }>("SELECT * FROM wl.payments WHERE id=$1 FOR UPDATE", [paymentId])
      ).rows[0];
      if (
        !p ||
        p.booking_id !== bId ||
        p.amount_cents !== session.amount_total ||
        session.currency !== "usd"
      )
        throw new AppError("Payment evidence does not match the invoice.");
      if (["paid", "partially_refunded", "refunded"].includes(p.status)) return;
      const intent =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id;
      await q(
        "UPDATE wl.payments SET status='paid',paid_at=now(),stripe_payment_id=$2,stripe_session_id=$3 WHERE id=$1",
        [p.id, intent, session.id],
      );
      const b = (
        await q<Booking>("SELECT * FROM wl.bookings WHERE id=$1", [
          p.booking_id,
        ])
      ).rows[0];
      await q(
        "INSERT INTO wl.events(id,name,session_id,customer_id,booking_id,attribution_id,metadata) VALUES($1,'payment_completed','',$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING",
        [
          "payment:" + p.id,
          p.customer_id,
          p.booking_id,
          b.attribution_id,
          JSON.stringify({ value_cents: p.amount_cents, currency: "USD" }),
        ],
      );
      await q(
        "INSERT INTO wl.timeline(id,customer_id,booking_id,type,body) VALUES($1,$2,$3,'payment_received',$4)",
        [
          randomUUID(),
          p.customer_id,
          p.booking_id,
          "Payment received: $" + (p.amount_cents / 100).toFixed(2),
        ],
      );
      await enqueueBooking(
        q,
        { ...b, price_cents: p.amount_cents },
        s,
        token,
        "payment",
        p.id,
      );
      const c = (
        await q<{ email: string; phone: string }>(
          "SELECT email,phone FROM wl.customers WHERE id=$1",
          [p.customer_id],
        )
      ).rows[0];
      await enqueue(q, {
        key: "meta:payment:" + p.id,
        channel: "meta",
        recipient: s.meta_dataset_id || s.meta_pixel_id,
        body: JSON.stringify(
          metaEvent("Purchase", "payment:" + p.id, {
            ...c,
            value: p.amount_cents,
            url: siteUrl() + "/booking/confirmation",
          }),
        ),
        customerId: p.customer_id,
        bookingId: p.booking_id,
      });
    }
    if (
      [
        "checkout.session.expired",
        "checkout.session.async_payment_failed",
      ].includes(event.type) &&
      paymentId
    )
      await q(
        "UPDATE wl.payments SET status=$2 WHERE id=$1 AND status='pending'",
        [paymentId, event.type.endsWith("expired") ? "expired" : "failed"],
      );
    if (event.type === "charge.refunded") {
      const charge = object as Stripe.Charge,
        intent =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : charge.payment_intent?.id;
      if (intent)
        await q(
          "UPDATE wl.payments SET refunded_cents=GREATEST(refunded_cents,$2),status=CASE WHEN $2>=amount_cents THEN 'refunded' ELSE 'partially_refunded' END WHERE stripe_payment_id=$1",
          [intent, charge.amount_refunded],
        );
    }
  });
}
