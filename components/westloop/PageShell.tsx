import { PublicHeader, PublicFooter } from "./PublicShell";
import { Tracking } from "./Tracking";
import type { BusinessSettings } from "@/lib/platform/types";
import { BRAND_NAME } from "@/lib/brand";
export function PageShell({
  business,
  children,
}: {
  business: BusinessSettings;
  children: React.ReactNode;
}) {
  return (
    <div className="ceramics-site">
      <link rel="icon" href={business.name === BRAND_NAME ? "/icon.svg" : business.favicon_url || "/icon.svg"} />
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
    </div>
  );
}
