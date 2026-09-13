import { randomUUID } from "node:crypto";
import { z } from "zod";
import { channels, type Attribution } from "./types";
import type { Query } from "./db";
const text = z.string().max(500).default("");
export const attributionSchema = z.object({
  source: text,
  medium: text,
  campaign: text,
  term: text,
  content: text,
  gclid: text,
  fbclid: text,
  landing_page: text,
  referrer: text,
});
export function normalizeAttribution(value: unknown): Attribution {
  const a = attributionSchema.parse(value || {});
  const src = a.source.toLowerCase(),
    medium = a.medium.toLowerCase();
  if (a.gclid || (src.includes("google") && /cpc|paid|ppc/.test(medium)))
    a.source = "Google Ads";
  else if (
    a.fbclid ||
    (/facebook|instagram|meta/.test(src) && /paid|cpc|social/.test(medium))
  )
    a.source = "Meta Ads";
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
    `INSERT INTO wl.attributions(id,session_id,source,medium,campaign,term,content,gclid,fbclid,landing_page,referrer)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(session_id) DO NOTHING`,
    [
      id,
      sessionId,
      a.source,
      a.medium,
      a.campaign,
      a.term,
      a.content,
      a.gclid,
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
