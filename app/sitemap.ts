import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/platform/settings";
import { query } from "@/lib/platform/db";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (process.env.ADMIN_PREVIEW === "true") return [];
  const services = await query<{ slug: string }>(
    "SELECT slug FROM wl.services WHERE active=true ORDER BY sort_order,name",
  );
  return [
    "",
    "/services",
    "/gallery",
    "/contact",
    "/booking",
    "/privacy-notice",
    "/service-rules",
    ...services.map((s) => "/services/" + s.slug),
  ].map((p) => ({
    url: siteUrl() + p,
    changeFrequency: "weekly",
    priority: p ? 0.7 : 1,
  }));
}
