import { publicData } from "@/lib/platform/public";
import { PageShell } from "@/components/westloop/PageShell";
import { CallLink } from "@/components/westloop/PublicShell";
import { ContactForm } from "@/components/westloop/ContactForm";
import Link from "next/link";
import { siteUrl } from "@/lib/platform/settings";
import { breadcrumbSchema, businessSchema, pageMetadata, serializeStructuredData, structuredData, webPageSchema } from "@/lib/seo";
import styles from "./Contact.module.css";
export const dynamic = "force-dynamic";
export const metadata = pageMetadata({
  title: "Contact Our Chicago Detailing Studio",
  description: "Contact West Loop Ceramics about car detailing, paint correction, or ceramic coating in Chicago. Check studio hours, ask about your vehicle, and plan your visit.",
  path: "/contact",
});
export default async function Page() {
  const { business } = await publicData();
  const schema = structuredData([
    businessSchema(siteUrl(), business),
    webPageSchema(siteUrl(), "/contact", "Contact West Loop Ceramics", String(metadata.description), "ContactPage"),
    breadcrumbSchema(siteUrl(), [{ name: "Contact", path: "/contact" }]),
  ]);
  return (
    <PageShell business={business} showBookingCTA={false} mobileBookingCTA>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(schema) }} />
      <section className={styles.layout} aria-label="Contact the studio">
        <div className={styles.intro}>
          <p className={styles.eyebrow}>WEST LOOP, CHICAGO</p>
          <h1>
            You're in
            <br />
            <em>good hands.</em>
          </h1>
          <p className={styles.lead}>Questions about detailing, paint correction or ceramic coating? Tell us what you drive and what you want to improve. We’ll recommend a clear next step.</p>
        </div>
        <div className={styles.panel}>
          <p className={styles.eyebrow}>A QUESTION BEFORE YOU BOOK?</p>
          <h2 id="enquiry-title">Tell us about your car.</h2>
          <p className={styles.panelIntro}>Share the vehicle, its condition, and your priorities. We’ll help you compare the right service, expected scope, and booking path.</p>
          <ContactForm />
        </div>
        <aside className={styles.studio} aria-labelledby="studio-title">
          <h2 id="studio-title">Your West Loop studio.</h2>
          <dl className={styles.details}>
            <div><dt>Visit us</dt><dd>{business.address || "West Loop, Chicago. Your appointment location is confirmed before your visit."}{business.address && <a target="_blank" rel="noreferrer" href={"https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(business.address)}>Get directions</a>}</dd></div>
            {business.hours_label && <div><dt>Studio hours</dt><dd>{business.hours_label.split(";").map(line => <span key={line}>{line.trim()}</span>)}</dd></div>}
            {business.email && <div><dt>Email us</dt><dd><a href={"mailto:" + business.email}>{business.email}</a></dd></div>}
            {business.phone && <div><dt>Call us</dt><dd><CallLink phone={business.phone} /></dd></div>}
            {business.service_area && <div><dt>Serving</dt><dd>{business.service_area}</dd></div>}
          </dl>
          <div className={styles.booking}><h3>Ready to book?</h3><p>Choose a service, review your estimate, and reserve an available time online.</p><Link href="/booking" className="button outline">Book an appointment</Link></div>
        </aside>
      </section>
    </PageShell>
  );
}
