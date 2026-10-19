import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  applicationName: "West Loop Admin",
  description: "West Loop Ceramics team workspace.",
  manifest: "/admin/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "West Loop Admin",
    statusBarStyle: "default",
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#f6f7f4" };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
