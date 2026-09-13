import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { query, transaction } from "./db";
import { defaultSettings } from "./seed";
import type { BusinessSettings } from "./types";
import { z } from "zod";

const optionalUrl = z.union([
  z.literal(""),
  z.url().refine((v) => /^https:\/\//.test(v), "Use an HTTPS URL."),
]);
export const settingsSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    phone: z.string().trim().max(30),
    email: z.union([z.literal(""), z.email()]),
    address: z.string().trim().max(240),
    hours_label: z.string().max(160),
    service_area: z.string().max(500),
    appointment_mode: z.enum(["shop", "mobile", "both"]),
    days: z.array(z.number().int().min(0).max(6)).min(1),
    open_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    close_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    buffer_minutes: z.number().int().min(0).max(180),
    deposit_percent: z.number().min(0).max(100),
    cancellation_policy: z.string().max(2000),
    logo_url: z
      .string()
      .max(500)
      .refine((v) => !v || /^\/api\/media\/[a-f0-9-]+$/.test(v)),
    favicon_url: z
      .string()
      .max(500)
      .refine((v) => !v || /^\/api\/media\/[a-f0-9-]+$/.test(v)),
    instagram_url: optionalUrl,
    google_review_url: optionalUrl,
    google_tag_id: z.string().regex(/^(|GT-[A-Z0-9]+)$/),
    ga4_id: z.string().regex(/^(|G-[A-Z0-9]+)$/),
    google_ads_id: z.string().regex(/^(|AW-\d+)$/),
    google_ads_label: z.string().regex(/^[a-zA-Z0-9_-]*$/),
    meta_pixel_id: z.string().regex(/^\d*$/),
    meta_dataset_id: z.string().regex(/^\d*$/),
    email_from: z.string().max(240),
    telegram_chat_id: z.string().max(80),
    sms_from: z.string().max(40),
    email_provider: z.literal("resend"),
  })
  .refine(
    (s) => s.open_time < s.close_time,
    "Closing time must follow opening time.",
  );
const envKeys: Record<string, string[]> = {
  email_key: ["EMAIL_PROVIDER_API_KEY", "RESEND_API_KEY"],
  telegram_token: ["TELEGRAM_BOT_TOKEN"],
  sms_account: ["SMS_PROVIDER_ACCOUNT_ID", "TWILIO_ACCOUNT_SID"],
  sms_token: ["SMS_PROVIDER_AUTH_TOKEN", "TWILIO_AUTH_TOKEN"],
  stripe_key: ["STRIPE_SECRET_KEY"],
  stripe_webhook: ["STRIPE_WEBHOOK_SECRET"],
  meta_token: ["META_ACCESS_TOKEN"],
  telegram_webhook: ["TELEGRAM_WEBHOOK_SECRET"],
};
export const secretKeys = Object.keys(envKeys);
export function siteUrl() {
  const v =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN
      : "http://localhost:3000");
  return new URL(v).origin;
}
export async function settings(): Promise<BusinessSettings> {
  const rows = await query<{ value: Partial<BusinessSettings> }>(
    "SELECT value FROM wl.settings WHERE key='business'",
  );
  return {
    ...defaultSettings,
    phone: process.env.NEXT_PUBLIC_BUSINESS_PHONE || "",
    email: process.env.BUSINESS_EMAIL || "",
    ga4_id: process.env.GOOGLE_ANALYTICS_ID || "",
    google_ads_id: process.env.GOOGLE_ADS_ID || "",
    google_ads_label: process.env.GOOGLE_ADS_CONVERSION_LABEL || "",
    meta_pixel_id: process.env.META_PIXEL_ID || "",
    email_from: process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || "",
    telegram_chat_id: process.env.TELEGRAM_CHAT_ID || "",
    sms_from:
      process.env.SMS_FROM_NUMBER || process.env.TWILIO_FROM_NUMBER || "",
    ...Object.fromEntries(
      Object.entries(rows[0]?.value || {}).filter(([, v]) => v !== ""),
    ),
  } as BusinessSettings;
}
function encryptionKey() {
  const key = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!key || key.length < 32)
    throw new Error(
      "Set SETTINGS_ENCRYPTION_KEY to a random secret of at least 32 characters before saving integration credentials.",
    );
  return createHash("sha256").update(key).digest();
}
export async function secret(key: string) {
  const row = (
    await query<{ ciphertext: string }>(
      "SELECT ciphertext FROM wl.secrets WHERE key=$1",
      [key],
    )
  )[0];
  if (row) {
    const [iv, tag, body] = row.ciphertext.split(".");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64")),
      decipher.final(),
    ]).toString();
  }
  return (envKeys[key] || []).map((k) => process.env[k]).find(Boolean) || "";
}
export async function saveSettings(
  input: unknown,
  credentials: Record<string, string> = {},
) {
  const s = settingsSchema.parse(input);
  if (
    s.deposit_percent > 0 &&
    !(await secret("stripe_key")) &&
    !credentials.stripe_key
  )
    throw new Error("Connect Stripe before enabling deposits.");
  await transaction(async (q) => {
    await q("SELECT id FROM wl.schedule_guard WHERE id=1 FOR UPDATE");
    await q(
      "UPDATE wl.settings SET value=$1::jsonb,updated_at=now() WHERE key='business'",
      [JSON.stringify(s)],
    );
    for (const [key, value] of Object.entries(credentials)) {
      if (!secretKeys.includes(key) || !value) continue;
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
      const data = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
      ]);
      const ciphertext = [iv, cipher.getAuthTag(), data]
        .map((v) => v.toString("base64"))
        .join(".");
      await q(
        "INSERT INTO wl.secrets(key,ciphertext) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET ciphertext=$2,updated_at=now()",
        [key, ciphertext],
      );
    }
  });
  return s;
}
export async function integrationStatus() {
  const s = await settings();
  const entries = await Promise.all(
    secretKeys.map(async (k) => [k, Boolean(await secret(k))] as const),
  );
  const c = Object.fromEntries(entries);
  return {
    credentials: c,
    email: c.email_key && Boolean(s.email_from),
    sms: c.sms_account && c.sms_token && Boolean(s.sms_from),
    telegram: c.telegram_token && Boolean(s.telegram_chat_id),
    stripe: c.stripe_key && c.stripe_webhook,
    google: Boolean(s.ga4_id || s.google_ads_id || s.google_tag_id),
    meta: Boolean(s.meta_pixel_id),
    meta_capi: c.meta_token && Boolean(s.meta_dataset_id || s.meta_pixel_id),
    google_ads_reporting: false,
    meta_ads_reporting: false,
  };
}
