import { PublicHeader, PublicFooter } from "./PublicShell";
import { Tracking } from "./Tracking";
import type { BusinessSettings } from "@/lib/platform/types";
import { publicSettings } from "@/lib/platform/settings";
import { BRAND_NAME } from "@/lib/brand";
export function PageShell({
  business,
  children,
  showBookingCTA = true,
  mobileBookingCTA = showBookingCTA,
  mobileBookingHref = "/booking",
  className = "",
}: {
  business: BusinessSettings;
  children: React.ReactNode;
  showBookingCTA?: boolean;
  mobileBookingCTA?: boolean;
  mobileBookingHref?: string;
  className?: string;
}) {
  const publicBusiness = publicSettings(business);
  return (
    <div className={`ceramics-site ${className}`}>
      <link rel="icon" href={business.name === BRAND_NAME ? "/icon.svg" : business.favicon_url || "/icon.svg"} />
      <PublicHeader business={publicBusiness} />
      <Tracking
        config={{
          google_tag_id: business.google_tag_id,
          ga4_id: business.ga4_id,
          google_ads_id: business.google_ads_id,
          google_ads_label: business.google_ads_label,
          google_ads_phone_label: business.google_ads_phone_label,
          meta_pixel_id: business.meta_pixel_id,
        }}
      />
      <main id="main">{children}</main>
      <PublicFooter business={publicBusiness} showBookingCTA={showBookingCTA} mobileBookingCTA={mobileBookingCTA} mobileBookingHref={mobileBookingHref} />
    </div>
  );
}
