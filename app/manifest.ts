import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
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
}
