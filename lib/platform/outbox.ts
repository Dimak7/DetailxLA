import { randomUUID, randomBytes } from "node:crypto";
import type { Query } from "./db";
import { hash } from "./auth";
import { siteUrl } from "./settings";
import { money, timeLabel, type Booking, type BusinessSettings } from "./types";
export async function enqueue(
  q: Query,
  input: {
    key: string;
    channel: string;
    recipient: string;
    subject?: string;
    body: string;
    customerId?: string;
    bookingId?: string;
    campaignId?: string;
    purpose?: string;
    scheduledAt?: string;
  },
) {
  await q(
    `INSERT INTO wl.messages(id,dedupe_key,channel,recipient,subject,body,customer_id,booking_id,campaign_id,purpose,scheduled_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::timestamptz,now())) ON CONFLICT(dedupe_key) DO NOTHING`,
    [
      randomUUID(),
      input.key,
      input.channel,
      input.recipient,
      input.subject || "",
      input.body,
      input.customerId || null,
      input.bookingId || null,
      input.campaignId || null,
      input.purpose || "transactional",
      input.scheduledAt || null,
    ],
  );
}
export function renderTemplate(text: string, vars: Record<string, string>) {
  return text.replace(/\{\{([a-z_]+)\}\}/g, (_, key) => vars[key] || "");
}
async function telegramBookingRequest(q: Query, b: Booking, s: BusinessSettings, customerName: string) {
  const paymentState = (await q<{ quote_pending: boolean; collected_cents: number }>(
    `SELECT EXISTS(SELECT 1 FROM wl.booking_line_items WHERE booking_id=$1 AND quote_pending) quote_pending,
      COALESCE((SELECT SUM(amount_cents-refunded_cents) FROM wl.payments
        WHERE booking_id=$1 AND status IN ('paid','partially_refunded','refunded')
          AND ((provider='square' AND metadata->>'square_environment'=$2)
            OR (provider<>'square' AND $2='production'))),0)::int collected_cents`,
    [b.id, s.square_environment || "production"],
  )).rows[0];
  // An agreed price can supersede the original catalogue's quote requirement.
  const needsQuote = b.price_cents === null || paymentState.quote_pending;
  const collected = Math.max(0, Number(paymentState.collected_cents));
  const depositDue = Math.max(0, b.deposit_cents - collected);
  const title = needsQuote ? "Quote request"
    : b.status === "confirmed" ? "Confirmed appointment"
    : b.status === "new" ? (depositDue > 0 ? "Booking request · deposit due" : "Booking request")
    : "Booking update";
  const status = b.status.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
  const details = [`Booking status: ${status}`];
  if (needsQuote) details.push("Quote required: confirm the scope and agreed price before collecting payment.");
  else {
    details.push(`Agreed service total: ${money(b.price_cents)}`);
    if (depositDue > 0) details.push(`Deposit due: ${money(depositDue)}`);
    else if (b.status === "new") details.push(b.deposit_cents > 0 ? "Deposit received; confirmation is pending." : "No deposit required; confirmation is pending.");
    details.push(`Remaining service balance: ${money(Math.max(0, b.price_cents! - collected))}`);
  }
  return { subject: `${title}: ${customerName}`, details: details.join("\n") };
}

export async function enqueueBooking(
  q: Query,
  b: Booking,
  s: BusinessSettings,
  token: string,
  event = "booking_confirmation",
  suffix = "",
  channels: Array<"email" | "sms"> = ["email", "sms"],
) {
  const c = (
    await q<{
      first_name: string;
      last_name: string;
      email: string;
      phone: string;
    }>(
      "SELECT first_name,last_name,email,phone FROM wl.customers WHERE id=$1",
      [b.customer_id],
    )
  ).rows[0];
  const v = (
    await q<{ year: number; make: string; model: string }>(
      "SELECT year,make,model FROM wl.vehicles WHERE id=$1",
      [b.vehicle_id],
    )
  ).rows[0];
  const a = b.attribution_id
    ? (
        await q<{ source: string; lead_stream: string }>(
          "SELECT source,lead_stream FROM wl.attributions WHERE id=$1",
          [b.attribution_id],
        )
      ).rows[0]
    : null;
  const vars: Record<string, string> = {
    business_name: s.name,
    customer_name: c.first_name + " " + c.last_name,
    service_name: b.service_name,
    booking_date: b.booking_date,
    booking_time: timeLabel(b.start_minute),
    vehicle: v.year + " " + v.make + " " + v.model,
    total: money(b.price_cents),
    phone: c.phone,
    email: c.email,
    source: a?.source || "Direct",
    notes: b.notes,
    booking_url:
      siteUrl() + "/booking/confirmation?id=" + b.id + "&token=" + token,
    admin_url: siteUrl() + "/admin/bookings?search=" + b.reference,
    review_url: s.google_review_url,
  };
  if (event === "review_request") {
    const rt = randomBytes(32).toString("hex");
    await q(
      "INSERT INTO wl.reviews(id,customer_id,booking_id,name,token_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT(booking_id) DO NOTHING",
      [randomUUID(), b.customer_id, b.id, vars.customer_name, hash(rt)],
    );
    vars.review_url = siteUrl() + "/review?token=" + rt;
  }
  const template = (
    await q<{ subject: string; body: string }>(
      "SELECT subject,body FROM wl.email_templates WHERE key=$1",
      [event],
    )
  ).rows[0];
  if (!template) return;
  const key = b.id + ":" + event + ":" + suffix;
  const subject = renderTemplate(template.subject, vars),
    body = renderTemplate(template.body, vars);
  if (channels.includes("email")) await enqueue(q, {
    key: key + ":email",
    channel: "email",
    recipient: c.email,
    subject,
    body,
    customerId: b.customer_id,
    bookingId: b.id,
  });
  if (event !== "review_request" && channels.includes("sms"))
    await enqueue(q, {
      key: key + ":sms",
      channel: "sms",
      recipient: c.phone,
      body: event === "booking_request"
        ? `${s.name}: Hi ${c.first_name}, we received your ${b.service_name} booking for ${b.booking_date} at ${vars.booking_time} CT. ${b.deposit_cents > 0 ? `Pay your ${money(b.deposit_cents)} deposit to confirm: ` : "View your booking and any quote or payment steps: "}${vars.booking_url}`
        : body,
      customerId: b.customer_id,
      bookingId: b.id,
    });
  if (channels.includes("email") && (
    event === "booking_request" ||
    event === "booking_cancelled" ||
    event === "payment"
  )) {
    const businessKey =
      event === "booking_request"
        ? "new_booking"
        : event === "booking_cancelled"
          ? "business_cancellation"
          : "payment";
    const t = (
      await q<{ subject: string; body: string }>(
        "SELECT subject,body FROM wl.email_templates WHERE key=$1",
        [businessKey],
      )
    ).rows[0];
    if (t) {
      const telegramRequest = event === "booking_request" ? await telegramBookingRequest(q, b, s, vars.customer_name) : null;
      for (const channel of ["email", "telegram"]) {
        const requestDetails = channel === "telegram" ? telegramRequest : null;
        await enqueue(q, {
          key: key + ":business:" + channel,
          channel,
          recipient: channel === "email" ? s.email : s.telegram_chat_id,
          subject: requestDetails?.subject || renderTemplate(t.subject, vars),
          body: renderTemplate(t.body, vars) + "\n\nMarketing stream: " + (a?.lead_stream || "Unassigned")
            + (requestDetails ? "\n\n" + requestDetails.details : ""),
          customerId: b.customer_id,
          bookingId: b.id,
        });
      }
    }
  }
  if (["booking_request", "booking_confirmation", "booking_rescheduled"].includes(event)) {
    const reminder = (
      await q<{ subject: string; body: string }>(
        "SELECT subject,body FROM wl.email_templates WHERE key='booking_reminder'",
      )
    ).rows[0];
    const due = (
      await q<{ due: string }>(
        `SELECT (($1::date + $2 * interval '1 minute') AT TIME ZONE 'America/Chicago' - interval '48 hours')::text due`,
        [b.booking_date, b.start_minute],
      )
    ).rows[0].due;
    if (reminder && new Date(due) > new Date())
      for (const channel of ["email", "sms"])
      {
        const reminderKey = b.id + ":reminder:48h:" + b.booking_date + ":" + b.start_minute + ":" + channel;
        // Rescheduling back to a previous time must restore its cancelled reminder.
        await q("UPDATE wl.messages SET status='queued',scheduled_at=$2::timestamptz,error='' WHERE dedupe_key=$1 AND status='cancelled'", [reminderKey, due]);
        await enqueue(q, {
          key: reminderKey,
          channel,
          recipient: channel === "email" ? c.email : c.phone,
          subject: renderTemplate(reminder.subject, vars),
          body: renderTemplate(reminder.body, vars),
          customerId: b.customer_id,
          bookingId: b.id,
          purpose: "reminder",
          scheduledAt: due,
        });
      }
  }
}
