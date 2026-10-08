import { randomUUID } from "node:crypto";
import { z } from "zod";
import { channels, leadStreams, type Attribution } from "./types";
import type { Query } from "./db";
const text = z.string().max(500).default("");
export const attributionSchema = z.object({
  source: text,
  lead_stream: text,
  medium: text,
  campaign: text,
  term: text,
  content: text,
  gclid: text,
  gbraid: text,
  wbraid: text,
  fbclid: text,
  landing_page: text,
  referrer: text,
});
export function normalizeLeadStream(value: string) {
  const stream = value.trim().toLowerCase().replace(/[_-]+/g, " ");
  if (/^dima(?: leads?)?$/.test(stream)) return "Dima Leads";
  if (/^(?:west ?loop|west loop leads?)$/.test(stream)) return "West Loop Leads";
  return leadStreams.includes(value as (typeof leadStreams)[number]) ? value : "Unassigned";
}
export function normalizeAttribution(value: unknown): Attribution {
  const a = attributionSchema.parse(value || {});
  const src = a.source.toLowerCase(),
    medium = a.medium.toLowerCase(),
    paid = /(?:^|[_\s-])(cpc|ppc|paid|paid social|paidsocial)(?:$|[_\s-])/.test(medium);
  a.lead_stream = normalizeLeadStream(a.lead_stream);
  if (
    a.gclid ||
    a.gbraid ||
    a.wbraid ||
    src === "google ads" ||
    (src.includes("google") && paid)
  )
    a.source = "Google Ads";
  else if (
    src === "meta ads" ||
    (paid && (a.fbclid || /facebook|instagram|meta/.test(src)))
  )
    a.source = "Meta Ads";
  else if (a.fbclid || /facebook|instagram|meta/.test(src))
    a.source = "Organic Social";
  else if (/gbp|google.business/.test(src))
    a.source = "Google Business Profile";
  else if (
    /organic/.test(medium) ||
    (!a.source && /google\.|bing\.|duckduckgo\./.test(a.referrer))
  )
    a.source = "Organic";
  else if (!channels.includes(a.source as (typeof channels)[number]))
    a.source = a.referrer ? "Referral" : a.source ? "Other" : "Direct";
  return a;
}
export async function saveAttribution(
  q: Query,
  sessionId: string,
  value: unknown,
) {
  const a = normalizeAttribution(value),
    id = randomUUID();
  await q(
    `INSERT INTO wl.attributions(id,session_id,source,lead_stream,medium,campaign,term,content,gclid,gbraid,wbraid,fbclid,landing_page,referrer)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(session_id) DO NOTHING`,
    [
      id,
      sessionId,
      a.source,
      a.lead_stream,
      a.medium,
      a.campaign,
      a.term,
      a.content,
      a.gclid,
      a.gbraid,
      a.wbraid,
      a.fbclid,
      a.landing_page,
      a.referrer,
    ],
  );
  return (
    await q<{ id: string }>(
      "SELECT id FROM wl.attributions WHERE session_id=$1",
      [sessionId],
    )
  ).rows[0].id;
}
