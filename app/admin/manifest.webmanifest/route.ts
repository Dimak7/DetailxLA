import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const manifest: MetadataRoute.Manifest = {
  id: "/admin",
  name: "West Loop Admin",
  short_name: "West Loop Admin",
  description: "West Loop Ceramics team workspace.",
  // Include /admin itself as well as its login and role-specific landing pages.
  start_url: "/admin",
  scope: "/admin",
  display: "standalone",
  background_color: "#f6f7f4",
  theme_color: "#f6f7f4",
  icons: [
    { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    { src: "/apple-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
  ],
};

// Install metadata must be readable before sign-in; the workspace stays protected.
export function GET() {
  return Response.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
