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
    title: `${BRAND_NAME} | Care in Every Layer`,
    description: BRAND_DESCRIPTION,
  },
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
