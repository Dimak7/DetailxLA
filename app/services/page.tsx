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
          <p>Choose focused interior or exterior care, a complete detail, paint refinement or long-term ceramic protection. Every service explains the scope, starting price and next step before you book.</p>
        </header>
        <ServiceMenu services={d.services} />
        {d.services.length > 0 && (
          <p className={styles.priceNote}>“From” prices, quotes and appointment times are confirmed before work begins.</p>
        )}
        <aside className={styles.help} aria-label="Help choosing a service">
          <div><h2>Not sure what to choose?</h2><p>Tell us what you drive, its current condition and what you want to improve. We’ll point you toward the right level of care without overselling the work.</p></div>
          <Link className="button small outline" href="/contact">Ask us for help</Link>
        </aside>
      </div>
    </PageShell>
  );
}
