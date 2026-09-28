import Stripe from "stripe";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { query, transaction, type Query } from "../platform/db";
import { AppError, receiptToken } from "../platform/auth";
import { secret, settings, siteUrl } from "../platform/settings";
import { bookingById } from "../platform/bookings";
import { enqueue, enqueueBooking } from "../platform/outbox";
import { metaEvent } from "./providers";
import type { Booking, BusinessSettings } from "../platform/types";
import {
  SQUARE_API_VERSION, squareApiBase, squareEnvironment, retrieveSquarePayment,
  upsertSquarePayment, type SquarePayment, type SquareMoney,
} from "./square-reporting";

type PaymentKind = "deposit" | "balance";
type PaymentProvider = "square" | "stripe";
type PaymentRow = {
  id: string;
  booking_id: string;
  customer_id: string;
  amount_cents: number;
  status: string;
  kind: PaymentKind;
  checkout_url: string;
};
type SquareRefund = {
  id?: string;
  payment_id?: string;
  status?: string;
  amount_money?: SquareMoney;
};
export type SquareEvent = {
  event_id: string;
  type: string;
  data?: { object?: { payment?: SquarePayment; refund?: SquareRefund } };
};

export async function configuredPaymentProvider(): Promise<PaymentProvider | null> {
  if (
    (await secret("square_access_token")) &&
    (await secret("square_location_id")) &&
    (await secret("square_webhook_signature_key"))
  )
    return "square";
  if ((await secret("stripe_key")) && (await secret("stripe_webhook")))
    return "stripe";
  return null;
}
async function preparePayment(
  bookingId: string,
  kind: PaymentKind,
  provider: PaymentProvider,
) {
  const b = await bookingById(bookingId);
  if (!b || ["cancelled", "no_show"].includes(b.status))
    throw new AppError("This appointment cannot be paid online.");
  if (b.price_cents == null)
    throw new AppError("A quote must be agreed before creating an invoice.");
  const payment = await transaction(async (q) => {
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
    const environment = squareEnvironment();
    const unclassified = (await q(
      `SELECT id FROM wl.payments WHERE booking_id=$1 AND provider='square'
       AND status IN ('paid','partially_refunded','refunded')
       AND COALESCE(metadata->>'square_environment','') NOT IN ('production','sandbox') LIMIT 1`,
      [bookingId],
    )).rows;
    if (unclassified.length)
      throw new AppError("Sync Square payments before collecting this appointment balance.");
    const paid = Number(
      (
        await q<{ amount: number }>(
          `SELECT COALESCE(SUM(amount_cents-refunded_cents),0)::int amount FROM wl.payments
           WHERE booking_id=$1 AND status IN ('paid','partially_refunded','refunded')
           AND (provider<>'square' OR metadata->>'square_environment'=$2)`,
          [bookingId, environment],
        )
      ).rows[0].amount,
    );
    const owed = Math.max(
      0,
      (kind === "deposit" ? current.deposit_cents : current.price_cents) - paid,
    );
    if (!owed)
      throw new AppError("There is no outstanding amount for this payment.");
    const old = (
      await q<PaymentRow>(
        `SELECT * FROM wl.payments WHERE booking_id=$1 AND provider=$2 AND status='pending'
         AND ($2<>'square' OR (metadata->>'square_environment'=$3 AND amount_cents=$4)) ORDER BY created_at LIMIT 1`,
        [bookingId, provider, environment, owed],
      )
    ).rows[0];
    if (old) return old;
    return (
      await q<PaymentRow>(
        "INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,kind,provider,metadata) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *",
        [randomUUID(), bookingId, b.customer_id, owed, kind, provider,
          JSON.stringify(provider === "square" ? { square_environment: squareEnvironment() } : {})],
      )
    ).rows[0];
  });
  return { booking: b, payment };
}

export async function createCheckout(
  bookingId: string,
  kind: PaymentKind = "balance",
) {
  const provider = await configuredPaymentProvider();
  if (!provider)
    throw new AppError(
      "Payments are not connected. Please contact the studio.",
      503,
    );
  const prepared = await preparePayment(bookingId, kind, provider);
  if (prepared.payment.checkout_url) return prepared.payment.checkout_url;
  return provider === "square"
    ? createSquareCheckout(prepared.booking, prepared.payment)
    : createStripeCheckout(prepared.booking, prepared.payment);
}

async function createSquareCheckout(b: Booking, p: PaymentRow) {
  const token = await secret("square_access_token"),
    locationId = await secret("square_location_id");
  if (!token || !locationId)
    throw new AppError("Square checkout is not configured.", 503);
  const receipt = await receiptToken(b.id),
    returnUrl =
      siteUrl() +
      "/booking/confirmation?id=" +
      b.id +
      "&token=" +
      receipt +
      "&payment=returned";
  const response = await fetch(
    squareApiBase() + "/v2/online-checkout/payment-links",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "Square-Version": SQUARE_API_VERSION,
      },
      body: JSON.stringify({
        idempotency_key: p.id,
        description: b.reference + " - " + b.service_name,
        order: {
          location_id: locationId,
          reference_id: p.id,
          line_items: [
            {
              name: (await settings()).name + " - " + b.service_name,
              quantity: "1",
              base_price_money: { amount: p.amount_cents, currency: "USD" },
            },
          ],
        },
        checkout_options: { redirect_url: returnUrl },
        pre_populated_data: b.email ? { buyer_email: b.email } : undefined,
        payment_note: "Booking " + b.reference,
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  const result = (await response.json().catch(() => ({}))) as {
    payment_link?: { id?: string; order_id?: string; url?: string };
    errors?: Array<{ detail?: string }>;
  };
  const link = result.payment_link;
  if (!response.ok || !link?.url || !link.order_id)
    throw new AppError(
      result.errors?.[0]?.detail || "Square payment link could not be created.",
      502,
    );
  await query(
    "UPDATE wl.payments SET checkout_url=$2,metadata=metadata||$3::jsonb WHERE id=$1",
    [
      p.id,
      link.url,
      JSON.stringify({
        square_environment: squareEnvironment(),
        square_order_id: link.order_id,
        square_payment_link_id: link.id || "",
      }),
    ],
  );
  return link.url;
}

async function createStripeCheckout(b: Booking, p: PaymentRow) {
  const key = await secret("stripe_key");
  if (!key) throw new AppError("Stripe checkout is not configured.", 503);
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

async function completePayment(
  q: Query,
  p: PaymentRow,
  s: BusinessSettings,
  details: {
    provider: PaymentProvider;
    externalId: string;
    stripeSessionId?: string;
    paymentMethod?: string;
    processorFeeCents?: number;
  },
) {
  if (["paid", "partially_refunded", "refunded"].includes(p.status)) return;
  await q(
    `UPDATE wl.payments SET status='paid',paid_at=now(),provider=$2,external_id=$3,
     stripe_payment_id=CASE WHEN $2='stripe' THEN $3 ELSE stripe_payment_id END,
     stripe_session_id=COALESCE($4,stripe_session_id),payment_method=$5,processor_fee_cents=$6 WHERE id=$1`,
    [
      p.id,
      details.provider,
      details.externalId,
      details.stripeSessionId || null,
      details.paymentMethod || "Card",
      details.processorFeeCents || 0,
    ],
  );
  await q(
    "UPDATE wl.bookings SET status='confirmed',updated_at=now() WHERE id=$1 AND status='new'",
    [p.booking_id],
  );
  const b = (
      await q<Booking>("SELECT * FROM wl.bookings WHERE id=$1", [p.booking_id])
    ).rows[0],
    token = await receiptToken(p.booking_id);
  await q(
    "INSERT INTO wl.events(id,name,session_id,customer_id,booking_id,attribution_id,metadata) VALUES($1,'payment_completed','',$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING",
    [
      "payment:" + p.id,
      p.customer_id,
      p.booking_id,
      b.attribution_id,
      JSON.stringify({
        value_cents: p.amount_cents,
        currency: "USD",
        provider: details.provider,
      }),
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
    b,
    s,
    token,
    "booking_confirmation",
    "payment-" + p.id,
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
  const object = event.data.object,
    session = object as Stripe.Checkout.Session,
    paymentId = session.metadata?.payment_id,
    bookingId = session.metadata?.booking_id,
    business = await settings();
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
      if (session.payment_status !== "paid" || !paymentId || !bookingId) return;
      await q("SELECT id FROM wl.bookings WHERE id=$1 FOR UPDATE", [bookingId]);
      const p = (
        await q<PaymentRow>("SELECT * FROM wl.payments WHERE id=$1 FOR UPDATE", [
          paymentId,
        ])
      ).rows[0];
      if (
        !p ||
        p.booking_id !== bookingId ||
        p.amount_cents !== session.amount_total ||
        session.currency !== "usd"
      )
        throw new AppError("Payment evidence does not match the invoice.");
      const intent =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id;
      if (!intent) throw new AppError("Payment evidence is incomplete.");
      await completePayment(q, p, business, {
        provider: "stripe",
        externalId: intent,
        stripeSessionId: session.id,
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
          "UPDATE wl.payments SET refunded_cents=GREATEST(refunded_cents,$2),status=CASE WHEN $2>=amount_cents THEN 'refunded' ELSE 'partially_refunded' END WHERE provider='stripe' AND external_id=$1",
          [intent, charge.amount_refunded],
        );
    }
  });
}

export async function verifySquareEvent(body: string, signature: string) {
  const key = await secret("square_webhook_signature_key"),
    notificationUrl =
      process.env.SQUARE_WEBHOOK_URL || siteUrl() + "/api/webhooks/square";
  if (!key)
    throw new AppError("Square webhook is not configured.", 503);
  const expected = createHmac("sha256", key)
    .update(notificationUrl + body)
    .digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "base64");
  } catch {
    throw new AppError("Invalid payment signature.", 400);
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new AppError("Invalid payment signature.", 400);
  let event: SquareEvent;
  try {
    event = JSON.parse(body) as SquareEvent;
  } catch {
    throw new AppError("Invalid Square webhook payload.", 400);
  }
  if (!event.event_id || !event.type)
    throw new AppError("Invalid Square webhook payload.", 400);
  return event;
}

export async function handleSquareEvent(event: SquareEvent) {
  const environment = squareEnvironment();
  const isRefund = ["refund.created", "refund.updated"].includes(event.type);
  let evidence: SquarePayment | undefined;
  if (["payment.created", "payment.updated"].includes(event.type)) {
    evidence = event.data?.object?.payment;
    if (!evidence?.id) throw new AppError("Square payment evidence is incomplete.", 400);
  } else if (isRefund) {
    const paymentId = event.data?.object?.refund?.payment_id;
    if (!paymentId) throw new AppError("Square refund evidence is incomplete.", 400);
    // Fetch before opening a transaction. A failed refresh must remain retryable
    // and must never increment a cumulative refund using an individual event.
    evidence = await retrieveSquarePayment(paymentId, environment);
  }
  const business = await settings();
  await transaction(async (q) => {
    const inserted = (await q(
      "INSERT INTO wl.webhooks(id,provider) VALUES($1,'square') ON CONFLICT DO NOTHING RETURNING id",
      [`square:${environment}:${event.event_id}`],
    )).rows;
    if (!inserted.length || !evidence) return;
    const payment = await upsertSquarePayment(q, evidence, environment, { reconcileInvoice: isRefund });
    const matches = (await q<PaymentRow>(
      `SELECT * FROM wl.payments WHERE provider='square' AND metadata->>'square_environment'=$3
       AND (external_id=$1 OR (COALESCE(external_id,'')='' AND $2<>'' AND metadata->>'square_order_id'=$2)) FOR UPDATE`,
      [payment.payment_id, payment.order_id, environment],
    )).rows;
    if (matches.length !== 1) return;
    const p = matches[0];
    if (payment.status === "COMPLETED") {
      // Tips belong in the ledger gross; invoice confirmation compares principal.
      // A split/foreign-currency payment still belongs in the ledger, but cannot
      // on its own confirm this website invoice.
      if (Number(payment.amount_cents) - Number(payment.tip_cents) !== p.amount_cents || payment.currency !== "USD") return;
      await completePayment(q, p, business, {
        provider: "square", externalId: payment.payment_id,
        paymentMethod: payment.payment_method,
        processorFeeCents: Math.max(0, Number(payment.processor_fee_cents)),
      });
      await q(`UPDATE wl.payments SET refunded_cents=LEAST(amount_cents,GREATEST(refunded_cents,$2::bigint)),
        processor_fee_cents=GREATEST(0,$3::bigint),
        paid_at=COALESCE($4::timestamptz,paid_at),
        status=CASE WHEN $2::bigint>=amount_cents AND $2::bigint>0 THEN 'refunded' WHEN $2::bigint>0 THEN 'partially_refunded' ELSE status END
        WHERE id=$1`, [p.id, payment.refunded_cents, payment.processor_fee_cents, payment.paid_at]);
    } else if (["CANCELED", "FAILED"].includes(payment.status)) {
      await q("UPDATE wl.payments SET status=$2,external_id=$3 WHERE id=$1 AND status='pending'",
        [p.id, payment.status === "CANCELED" ? "expired" : "failed", payment.payment_id]);
    }
  });
}
