import { settings, secret, siteUrl } from "../platform/settings";
import { hash } from "../platform/auth";
import type { Message } from "../platform/types";

export class NotConnected extends Error {}
async function post(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(15000),
  });
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok)
    throw new Error(
      "Provider request failed (HTTP " +
        response.status +
        "). Check credentials and provider logs.",
    );
  return data;
}
function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export async function deliver(m: Message) {
  const s = await settings();
  if (!m.recipient) throw new NotConnected("Recipient is not configured.");
  if (m.channel === "email") {
    const key = await secret("email_key");
    if (!key || !s.email_from)
      throw new NotConnected(
        "Email is not connected. Set the provider API key and verified sender.",
      );
    const result = await post("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        "Idempotency-Key": m.id,
      },
      body: JSON.stringify({
        from: s.email_from,
        to: [m.recipient],
        subject: m.subject,
        text: m.body,
        html:
          '<div style="background:#f5f3ec;padding:36px;font-family:Georgia,serif;color:#1d3530"><p style="letter-spacing:3px;font:12px sans-serif">' +
          escape(s.name.toUpperCase()) +
          '</p><h1 style="font-size:30px">' +
          escape(m.subject) +
          '</h1><div style="font:16px/1.8 sans-serif;white-space:pre-line">' +
          escape(m.body) +
          "</div></div>",
        ...(s.email ? { reply_to: s.email } : {}),
      }),
    });
    return String(result.id || "");
  }
  if (m.channel === "sms") {
    const account = await secret("sms_account"),
      token = await secret("sms_token");
    if (!account || !token || !s.sms_from)
      throw new NotConnected(
        "SMS is not connected. Set Twilio credentials and messaging number.",
      );
    const result = await post(
      "https://api.twilio.com/2010-04-01/Accounts/" +
        encodeURIComponent(account) +
        "/Messages.json",
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " + Buffer.from(account + ":" + token).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: m.recipient,
          From: s.sms_from,
          Body: m.body,
          StatusCallback: siteUrl() + "/api/webhooks/sms?message=" + m.id,
        }),
      },
    );
    return String(result.sid || "");
  }
  if (m.channel === "telegram") {
    const token = await secret("telegram_token");
    if (!token)
      throw new NotConnected(
        "Telegram is not connected. Set bot token and chat ID.",
      );
    const result = await post(
      "https://api.telegram.org/bot" + token + "/sendMessage",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: m.recipient,
          text: s.name + "\n\n" + m.subject + "\n\n" + m.body,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "Open appointments",
                  url: siteUrl() + "/admin/bookings",
                },
              ],
            ],
          },
        }),
      },
    );
    if (!result.ok)
      throw new Error("Telegram rejected the message. Check bot access.");
    return String((result.result as { message_id?: number })?.message_id || "");
  }
  if (m.channel === "meta") {
    const token = await secret("meta_token"),
      pixel = s.meta_dataset_id || s.meta_pixel_id;
    if (!token || !pixel)
      throw new NotConnected("Meta Conversions API is not connected.");
    const result = await post(
      "https://graph.facebook.com/" +
        (process.env.META_API_VERSION || "v23.0") +
        "/" +
        pixel +
        "/events",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ data: [JSON.parse(m.body)] }),
      },
    );
    if (!result.events_received)
      throw new Error("Meta did not acknowledge the event.");
    return m.id;
  }
  throw new NotConnected("Provider is not connected.");
}
export function metaEvent(
  name: string,
  eventId: string,
  input: { email: string; phone: string; value: number | null; url: string },
) {
  return {
    event_name: name,
    event_id: eventId,
    event_time: Math.floor(Date.now() / 1000),
    action_source: "website",
    event_source_url: input.url,
    user_data: {
      em: [hash(input.email.toLowerCase().trim())],
      ph: [hash(input.phone.replace(/\D/g, ""))],
    },
    ...(input.value == null
      ? {}
      : { custom_data: { value: input.value / 100, currency: "USD" } }),
  };
}
