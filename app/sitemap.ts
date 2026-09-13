import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/platform/settings";
import { publicData } from "@/lib/platform/public";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { services } = await publicData();
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
