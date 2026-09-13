import { PublicHeader, PublicFooter } from "./PublicShell";
import { Tracking } from "./Tracking";
import type { BusinessSettings } from "@/lib/platform/types";
export function PageShell({
  business,
  children,
}: {
  business: BusinessSettings;
  children: React.ReactNode;
}) {
  return (
    <>
      <link rel="icon" href={business.favicon_url || "/icon.svg"} />
      <PublicHeader business={business} />
      <Tracking
        config={{
          google_tag_id: business.google_tag_id,
          ga4_id: business.ga4_id,
          google_ads_id: business.google_ads_id,
          google_ads_label: business.google_ads_label,
          meta_pixel_id: business.meta_pixel_id,
        }}
      />
      <main id="main">{children}</main>
      <PublicFooter business={business} />
    </>
  );
}
