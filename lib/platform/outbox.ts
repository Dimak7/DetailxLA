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
export async function enqueueBooking(
  q: Query,
  b: Booking,
  s: BusinessSettings,
  token: string,
  event = "booking_confirmation",
  suffix = "",
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
        await q<{ source: string }>(
          "SELECT source FROM wl.attributions WHERE id=$1",
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
  await enqueue(q, {
    key: key + ":email",
    channel: "email",
    recipient: c.email,
    subject,
    body,
    customerId: b.customer_id,
    bookingId: b.id,
  });
  if (event !== "review_request")
    await enqueue(q, {
      key: key + ":sms",
      channel: "sms",
      recipient: c.phone,
      body,
      customerId: b.customer_id,
      bookingId: b.id,
    });
  if (
    event === "booking_confirmation" ||
    event === "booking_cancelled" ||
    event === "payment"
  ) {
    const businessKey =
      event === "booking_confirmation"
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
    if (t)
      for (const channel of ["email", "telegram"])
        await enqueue(q, {
          key: key + ":business:" + channel,
          channel,
          recipient: channel === "email" ? s.email : s.telegram_chat_id,
          subject: renderTemplate(t.subject, vars),
          body: renderTemplate(t.body, vars),
          customerId: b.customer_id,
          bookingId: b.id,
        });
  }
  if (event === "booking_confirmation" || event === "booking_rescheduled") {
    const reminder = (
      await q<{ subject: string; body: string }>(
        "SELECT subject,body FROM wl.email_templates WHERE key='booking_reminder'",
      )
    ).rows[0];
    const due = (
      await q<{ due: string }>(
        `SELECT (($1::date + $2 * interval '1 minute') AT TIME ZONE 'America/Chicago' - interval '1 day')::text due`,
        [b.booking_date, b.start_minute],
      )
    ).rows[0].due;
    if (new Date(due) > new Date())
      for (const channel of ["email", "sms"])
        await enqueue(q, {
          key:
            b.id +
            ":reminder:" +
            b.booking_date +
            ":" +
            b.start_minute +
            ":" +
            channel,
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
