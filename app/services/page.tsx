import type { Metadata } from "next";
import Link from "next/link";
import { publicData } from "@/lib/platform/public";
import { PageShell } from "@/components/westloop/PageShell";
import { ServiceMenu } from "@/components/westloop/ServiceMenu";
import styles from "@/components/westloop/ServiceMenu.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Car Detailing, Paint Correction & Ceramic Coating Prices in Chicago",
  alternates: { canonical: "/services" },
  description: "Compare car detailing, paint correction and ceramic coating at a glance. See current prices, estimated times and book your service in Chicago's West Loop.",
};

export default async function Page() {
  const d = await publicData();
  return (
    <PageShell business={d.business} showBookingCTA={false} mobileBookingCTA>
      <div className={styles.page}>
        <header className={styles.heading}>
          <p className={styles.eyebrow}>CAR CARE IN CHICAGO</p>
          <h1>Services &amp; prices.</h1>
          <p>Detailing for a cleaner car. Paint correction for swirls and haze. Ceramic coating for protection.</p>
        </header>
        <ServiceMenu services={d.services} />
        {d.services.length > 0 && (
          <p className={styles.priceNote}>“From” prices, quotes and appointment times are confirmed before work begins.</p>
        )}
        <aside className={styles.help} aria-label="Help choosing a service">
          <div><h2>Not sure what to choose?</h2><p>Tell us about your car. We’ll help you find the right service.</p></div>
          <Link href="/contact">Ask us for help</Link>
        </aside>
      </div>
    </PageShell>
  );
}
