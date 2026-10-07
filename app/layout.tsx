import type { Metadata } from "next";
import { Manrope, Cormorant_Garamond } from "next/font/google";
import { siteUrl } from "@/lib/platform/settings";
import { BRAND_DESCRIPTION, BRAND_NAME } from "@/lib/brand";
import "./globals.css";
import "./ceramics.css";
const body = Manrope({ subsets: ["latin"], variable: "--font-body" });
const display = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-display",
});
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${BRAND_NAME} | Ceramic Coatings & Detailing in Chicago`,
    template: `%s | ${BRAND_NAME}`,
  },
  description:
    BRAND_DESCRIPTION,
  openGraph: {
    siteName: BRAND_NAME,
    type: "website",
    locale: "en_US",
    url: "/",
    title: `${BRAND_NAME} | Premium Automotive Detailing in Chicago`,
    description: BRAND_DESCRIPTION,
    images: [{ url: "/brand/social-preview.jpg", width: 1200, height: 630, alt: "West Loop Ceramics premium automotive detailing studio" }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${BRAND_NAME} | Premium Automotive Detailing in Chicago`,
    description: BRAND_DESCRIPTION,
    images: ["/brand/social-preview.jpg"],
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/manifest.webmanifest",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body className={body.variable + " " + display.variable}>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
