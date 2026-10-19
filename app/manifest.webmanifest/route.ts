import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const manifest: MetadataRoute.Manifest = {
  name: "West Loop Ceramics",
  short_name: "West Loop Ceramics",
  description: "Premium automotive detailing, paint correction and ceramic coating in Chicago's West Loop.",
  start_url: "/",
  display: "standalone",
  background_color: "#151719",
  theme_color: "#151719",
  icons: [
    { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    { src: "/apple-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
  ],
};

// An explicit route lets each layout choose its manifest. A root manifest.ts
// would override the admin layout's manifest link through file-based metadata.
export function GET() {
  return Response.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
