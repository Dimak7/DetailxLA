import type { Metadata } from "next";
import { Manrope, Cormorant_Garamond } from "next/font/google";
import { siteUrl } from "@/lib/platform/settings";
import "./globals.css";
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
    default: "West Loop Auto Spa | Considered Car Care in Chicago",
    template: "%s | West Loop Auto Spa",
  },
  description:
    "A considered approach to car detailing in Chicago's West Loop. Explore interior detailing, paint correction and ceramic protection. Book your appointment online.",
  openGraph: {
    siteName: "West Loop Auto Spa",
    type: "website",
    title: "West Loop Auto Spa",
    description: "Exceptional care. An extraordinary finish.",
  },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={body.variable + " " + display.variable}>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
