import { randomUUID, createHmac } from "node:crypto";
import { query, transaction, type Query } from "./db";
import { AppError, receiptKey } from "./auth";
import { enqueue } from "./outbox";
import { settings, siteUrl } from "./settings";
import type { Customer, Row } from "./types";
export const audiences = [
  "all",
  "inactive60",
  "inactive90",
  "ceramic",
  "interior",
  "repeat",
] as const;
export async function audience(q: Query, name: string, channel: string) {
  if (!audiences.includes(name as (typeof audiences)[number]))
    throw new AppError("Choose a valid audience.");
  const clauses: Record<string, string> = {
    all: "true",
    inactive60:
      "NOT EXISTS(SELECT 1 FROM wl.bookings b WHERE b.customer_id=c.id AND b.created_at>now()-interval '60 days' AND b.status NOT IN ('cancelled','no_show'))",
    inactive90:
      "NOT EXISTS(SELECT 1 FROM wl.bookings b WHERE b.customer_id=c.id AND b.created_at>now()-interval '90 days' AND b.status NOT IN ('cancelled','no_show'))",
    ceramic:
      "EXISTS(SELECT 1 FROM wl.bookings b WHERE b.customer_id=c.id AND b.service_name ILIKE '%ceramic%')",
    interior:
      "EXISTS(SELECT 1 FROM wl.bookings b WHERE b.customer_id=c.id AND b.service_name ILIKE '%interior%')",
    repeat:
      "(SELECT count(*) FROM wl.bookings b WHERE b.customer_id=c.id AND b.status='completed')>1",
  };
  const consent =
    channel === "sms"
      ? "c.marketing_sms AND NOT c.sms_opted_out"
      : "c.marketing_email";
  return (
    await q<Customer>(
      "SELECT c.* FROM wl.customers c WHERE " +
        consent +
        " AND " +
        clauses[name] +
        " ORDER BY c.created_at",
      [],
    )
  ).rows;
}
export async function unsubscribeToken(id: string, channel: string) {
  return createHmac("sha256", await receiptKey())
    .update("unsubscribe:" + channel + ":" + id)
    .digest("hex");
}
export async function queueCampaign(id: string) {
  const s = await settings(),
    key = await receiptKey();
  await transaction(async (q) => {
    const c = (
      await q<Row>("SELECT * FROM wl.campaigns WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (!c) throw new AppError("Campaign not found.", 404);
    if (!["draft", "scheduled"].includes(String(c.status)))
      throw new AppError("This campaign has already been queued.");
    const people = await audience(q, String(c.audience), String(c.channel));
    const recipients = new Set<string>();
    for (const person of people) {
      const recipient = c.channel === "sms" ? person.phone : person.email;
      if (recipients.has(recipient)) continue;
      recipients.add(recipient);
      const token = createHmac("sha256", key)
        .update("unsubscribe:" + c.channel + ":" + person.id)
        .digest("hex");
      const footer =
        c.channel === "sms"
          ? "\n" + s.name + ". Reply STOP to opt out."
          : "\n\n" +
            s.name +
            (s.address ? "\n" + s.address : "") +
            "\nUnsubscribe: " +
            siteUrl() +
            "/unsubscribe?id=" +
            person.id +
            "&channel=email&token=" +
            token;
      await enqueue(q, {
        key: "campaign:" + id + ":" + person.id,
        channel: String(c.channel),
        recipient,
        subject: String(c.subject),
        body:
          String(c.body).replaceAll("{{customer_name}}", person.first_name) +
          footer,
        customerId: person.id,
        campaignId: id,
        purpose: "marketing",
      });
    }
    await q("UPDATE wl.campaigns SET status='queued' WHERE id=$1", [id]);
  });
}
export async function optOut(phone: string) {
  await transaction(async (q) => {
    const rows = (
      await q<{ id: string }>(
        "UPDATE wl.customers SET marketing_sms=false,sms_opted_out=true,updated_at=now() WHERE phone=$1 RETURNING id",
        [phone],
      )
    ).rows;
    for (const row of rows) {
      await q(
        "INSERT INTO wl.consent_events(id,customer_id,channel,consent,wording,source) VALUES($1,$2,'sms',false,'STOP received','Twilio webhook')",
        [randomUUID(), row.id],
      );
      await q(
        "UPDATE wl.messages SET status='cancelled',error='Recipient opted out' WHERE customer_id=$1 AND channel='sms' AND status IN ('queued','failed','skipped')",
        [row.id],
      );
    }
  });
}
