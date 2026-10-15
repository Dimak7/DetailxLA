import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/platform/settings";
export const dynamic = "force-dynamic";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/api/",
        "/booking/confirmation",
        "/review",
        "/unsubscribe",
      ],
    },
    sitemap: siteUrl() + "/sitemap.xml",
  };
}
