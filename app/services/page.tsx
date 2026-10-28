import Link from "next/link";
import { publicData } from "@/lib/platform/public";
import { PageShell } from "@/components/westloop/PageShell";
import { ServiceMenu } from "@/components/westloop/ServiceMenu";
import { siteUrl } from "@/lib/platform/settings";
import { breadcrumbSchema, pageMetadata, serializeStructuredData, structuredData, webPageSchema } from "@/lib/seo";
import styles from "@/components/westloop/ServiceMenu.module.css";

export const dynamic = "force-dynamic";
export const metadata = pageMetadata({
  title: "Car Detailing & Paint Care Prices in Chicago",
  path: "/services",
  description: "Compare interior and exterior detailing, paint correction, and ceramic coating in Chicago's West Loop. See current prices, inclusions, and appointment estimates.",
});

export default async function Page() {
  const d = await publicData();
  const schema = structuredData([
    webPageSchema(siteUrl(), "/services", "Car Detailing & Paint Care Prices in Chicago", String(metadata.description), "CollectionPage"),
    breadcrumbSchema(siteUrl(), [{ name: "Services", path: "/services" }]),
    { "@type": "ItemList", "@id": `${siteUrl()}/services#service-list`, itemListElement: d.services.map((service, index) => ({
      "@type": "ListItem", position: index + 1, name: service.name, url: `${siteUrl()}/services/${service.slug}`,
    })) },
  ]);
  return (
    <PageShell business={d.business} showBookingCTA={false} mobileBookingCTA>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(schema) }} />
      <div className={styles.page}>
        <header className={styles.heading}>
          <p className={styles.eyebrow}>CAR CARE IN CHICAGO</p>
          <h1>Services &amp; prices.</h1>
          <p>Choose focused interior or exterior care, a complete detail, paint refinement or long-term ceramic protection. Every service explains the scope, starting price, and next step before you book.</p>
        </header>
        <ServiceMenu services={d.services} />
        {d.services.length > 0 && (
          <p className={styles.priceNote}>“From” prices, quotes, and appointment times are confirmed before work begins.</p>
        )}
        <aside className={styles.help} aria-label="Help choosing a service">
          <div><h2>Not sure what to choose?</h2><p>Tell us what you drive, its current condition, and what you want to improve. We’ll point you toward the right level of care without overselling the work.</p></div>
          <Link className="button small outline" href="/contact">Ask us for help</Link>
        </aside>
      </div>
    </PageShell>
  );
}
