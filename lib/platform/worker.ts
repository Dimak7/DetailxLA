import { query, transaction } from "./db";
import { deliver, NotConnected } from "../integrations/providers";
import { queueCampaign } from "./campaigns";
import type { Message } from "./types";
import { randomUUID } from "node:crypto";
import { enqueueBooking } from "./outbox";
import { receiptToken } from "./auth";
import { settings } from "./settings";
import type { Booking } from "./types";
export async function processOutbox(limit = 25) {
  await query(`UPDATE wl.messages m SET status='cancelled',error='Appointment notice is no longer current'
    FROM wl.bookings b WHERE m.booking_id=b.id AND m.status='queued'
    AND split_part(m.dedupe_key,':',2) IN ('booking_request','booking_confirmation','booking_rescheduled')
    AND (b.status IN ('completed','cancelled','no_show') OR
      ((b.booking_date::date + b.start_minute * interval '1 minute') AT TIME ZONE 'America/Chicago')<=now())`);
  // Cover upcoming appointments created before reminder scheduling was enabled.
  // Only backfill appointments whose 48-hour reminder is still in the future.
  const missingReminders = await query<Booking>(`SELECT b.* FROM wl.bookings b
    JOIN wl.customers c ON c.id=b.customer_id WHERE c.archived_at IS NULL
    AND b.status IN ('new','confirmed')
    AND ((b.booking_date::date + b.start_minute * interval '1 minute') AT TIME ZONE 'America/Chicago') > now()+interval '48 hours'
    AND NOT EXISTS(SELECT 1 FROM wl.messages m WHERE m.booking_id=b.id AND m.purpose='reminder'
      AND m.dedupe_key=b.id::text||':reminder:48h:'||b.booking_date||':'||b.start_minute::text||':sms' AND m.status<>'cancelled')
    ORDER BY b.booking_date,b.start_minute LIMIT 50`);
  if (missingReminders.length) {
    const business = await settings();
    for (const booking of missingReminders) {
      const token = await receiptToken(booking.id);
      await transaction(q => enqueueBooking(q, booking, business, token, "booking_request", "backfill", []));
    }
  }
  const scheduled = await query<{ id: string }>(
    "SELECT id FROM wl.campaigns WHERE status='scheduled' AND scheduled_at<=now() LIMIT 10",
  );
  for (const c of scheduled)
    try {
      await queueCampaign(c.id);
    } catch {
      /* Another worker may already have queued it. */
    }
  await query(
    "UPDATE wl.messages SET status='uncertain',error='Delivery acknowledgement interrupted; verify provider before retrying' WHERE status='sending' AND locked_at<now()-interval '5 minutes'",
  );
  let processed = 0;
  for (let i = 0; i < limit; i++) {
    const m = await transaction(async (q) => {
      const row = (
        await q<Message>(
          "SELECT * FROM wl.messages WHERE status='queued' AND scheduled_at<=now() ORDER BY scheduled_at FOR UPDATE SKIP LOCKED LIMIT 1",
        )
      ).rows[0];
      if (!row) return null;
      await q(
        "UPDATE wl.messages SET status='sending',locked_at=now(),attempts=attempts+1 WHERE id=$1",
        [row.id],
      );
      return row;
    });
    if (!m) break;
    try {
      if (m.customer_id && (m.purpose === "marketing" || m.channel === "sms")) {
        const c = (
          await query<{
            marketing_sms: boolean;
            marketing_email: boolean;
            sms_opted_out: boolean;
            phone: string;
            archived_at: string | null;
          }>(
            "SELECT marketing_sms,marketing_email,sms_opted_out,phone,archived_at FROM wl.customers WHERE id=$1",
            [m.customer_id],
          )
        )[0];
        const otherStop =
          m.channel === "sms" &&
          (
            await query(
              "SELECT id FROM wl.customers WHERE phone=$1 AND sms_opted_out=true LIMIT 1",
              [m.recipient],
            )
          ).length;
        if (
          !c ||
          (m.channel === "sms" && (c.sms_opted_out || otherStop)) ||
          (m.purpose === "marketing" &&
            (c.archived_at || !(m.channel === "sms" ? c.marketing_sms : c.marketing_email)))
        ) {
          await query(
            "UPDATE wl.messages SET status='cancelled',error='No current consent or recipient opted out' WHERE id=$1",
            [m.id],
          );
          continue;
        }
      }
      if (m.purpose === "reminder" && m.booking_id) {
        const b = (
          await query<{ status: string; upcoming: boolean }>(
            "SELECT status, ((booking_date::date + start_minute * interval '1 minute') AT TIME ZONE 'America/Chicago') > now() upcoming FROM wl.bookings WHERE id=$1",
            [m.booking_id],
          )
        )[0];
        if (!b || !b.upcoming || !["new", "confirmed"].includes(b.status)) {
          await query("UPDATE wl.messages SET status='cancelled' WHERE id=$1", [
            m.id,
          ]);
          continue;
        }
      }
      const provider = await deliver(m);
      await transaction(async (q) => {
        await q(
          "UPDATE wl.messages SET status='sent',provider_id=$2,sent_at=now(),error='' WHERE id=$1",
          [m.id, provider],
        );
        if (m.customer_id)
          await q(
            "INSERT INTO wl.timeline(id,customer_id,booking_id,type,body) VALUES($1,$2,$3,$4,$5)",
            [
              randomUUID(),
              m.customer_id,
              m.booking_id,
              m.channel + "_sent",
              m.subject || m.channel + " notification sent",
            ],
          );
      });
    } catch (e) {
      const isMissing = e instanceof NotConnected;
      await query("UPDATE wl.messages SET status=$2,error=$3 WHERE id=$1", [
        m.id,
        isMissing
          ? "skipped"
          : e instanceof Error && /timeout|fetch failed/i.test(e.message)
            ? "uncertain"
            : "failed",
        isMissing
          ? e.message
          : "Provider delivery failed. Verify credentials and provider logs before retrying.",
      ]);
    }
    processed++;
  }
  await query(
    "UPDATE wl.campaigns c SET status='completed' WHERE status='queued' AND NOT EXISTS(SELECT 1 FROM wl.messages m WHERE m.campaign_id=c.id AND m.status IN ('queued','sending'))",
  );
  return processed;
}
