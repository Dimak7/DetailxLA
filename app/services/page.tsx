import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { publicData } from "@/lib/platform/public";
import { PageShell } from "@/components/westloop/PageShell";
import { ServiceCards } from "@/components/westloop/ServiceCards";
import { careStages, servicePrice } from "@/lib/service-content";
import styles from "@/components/westloop/ServiceDetails.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Ceramic Coating & Detailing Services in Chicago",
  alternates: { canonical: "/services" },
  description: "Find the right care for your car. Explore ceramic coating, paint correction and interior and exterior detailing, with current pricing and online booking.",
};

export default async function Page() {
  const d = await publicData();
  const coating = d.services.find((service) => service.slug === "ceramic-coating");
  const orderedServices = [...d.services].sort((a, b) => Number(b.slug === "ceramic-coating") - Number(a.slug === "ceramic-coating"));
  return (
    <PageShell business={d.business}>
      <div className={styles.page}>
        <section className={styles.menuHero}>
          <div className={styles.menuHeroCopy}>
            <p className={styles.eyebrow}>THE WEST LOOP CERAMICS SERVICE COLLECTION</p>
            <h1>Protect the finish.<br /><em>Enjoy the drive.</em></h1>
            <p className={styles.lead}>From the first careful wash to a thoughtfully protected finish. Find the right attention for your car, and a care routine that fits your life.</p>
            <a className={styles.textLink} href="#all-services">Explore every service <span aria-hidden="true">↓</span></a>
            {coating && (
              <div className={styles.flagship}>
                <p className={styles.eyebrow}>OUR SIGNATURE SERVICE</p>
                <div className={styles.flagshipTitle}><h2>{coating.name}</h2><span>{servicePrice(coating)}</span></div>
                <p>Careful preparation. A protective surface layer. A finish that is easier to look after.</p>
                <Link className={styles.textLink} href={`/services/${coating.slug}`}>Discover ceramic protection <span aria-hidden="true">↗</span></Link>
              </div>
            )}
          </div>
          <figure className={styles.menuHeroImage}>
            <Image src="/portfolio/black-porsche-studio.jpg" alt="Black Porsche with light tracing its hood and front fenders" fill priority sizes="(max-width: 800px) 100vw, 48vw" />
            <figcaption>THE ART OF A CONSIDERED FINISH <span>Editorial imagery</span></figcaption>
          </figure>
        </section>

        <section className={styles.section} aria-labelledby="right-care-heading">
          <div className={styles.sectionHeading}>
            <div><p className={styles.eyebrow}>FIND THE RIGHT CARE</p><h2 id="right-care-heading">A clean car. A clear distinction.</h2></div>
            <p>Cleaning, correction and protection do different jobs. Start with what you want to change.</p>
          </div>
          <div className={styles.comparison}>
            {careStages.map((stage) => {
              const offered = d.services.find((service) => service.slug === stage.slug);
              return (
                <article key={stage.slug} className={styles.comparisonCard}>
                  <span className={styles.stepNumber}>{stage.number}</span><h3>{stage.title}</h3>
                  <strong>{stage.purpose}</strong><p>{stage.detail}</p><p className={styles.comparisonNote}>{stage.boundary}</p>
                  {offered && <Link className={styles.textLink} href={`/services/${offered.slug}`}>{offered.name} <span aria-hidden="true">↗</span></Link>}
                </article>
              );
            })}
          </div>
          <p className={styles.sectionNote}>Ceramic coating does not remove existing scratches or prevent stone chips. If the paint needs refining, we discuss correction separately before applying protection.</p>
        </section>

        <section className={`${styles.section} ${styles.menuSection}`} id="all-services" aria-labelledby="service-menu-heading">
          <div className={styles.sectionHeading}>
            <div><p className={styles.eyebrow}>THE COMPLETE MENU</p><h2 id="service-menu-heading">Good care, at every stage.</h2></div>
            <p>Explore what is included, understand the process and choose an appointment for your vehicle.</p>
          </div>
          <ServiceCards services={orderedServices} />
          <p className={styles.sectionNote}>Listed prices are for sedans unless noted. Vehicle size and condition may affect the final scope. Starting prices and consultation services are confirmed after assessment; additional work is discussed before we begin.</p>
        </section>

        <section className={styles.section} aria-labelledby="before-booking-heading">
          <div className={styles.faqLayout}>
            <div><p className={styles.eyebrow}>BEFORE YOU BOOK</p><h2 id="before-booking-heading">A little clarity.<br /><em>A better appointment.</em></h2><p className={styles.bodyCopy}>The best starting point is your car as it is today. Tell us about its condition and what you would like to improve.</p></div>
            <div className={styles.faqs}>
              <details><summary>Which service should I choose?<span aria-hidden="true">+</span></summary><p>Choose Exterior or Interior Detail for a focused refresh, or Full Detail for both. Paint Correction addresses suitable paint defects; Ceramic Coating adds protection to a prepared surface. If you are unsure, contact us with your vehicle and your priorities.</p></details>
              <details><summary>What does a starting price mean?<span aria-hidden="true">+</span></summary><p>It is the baseline for that service. Vehicle size, condition and the preparation needed can change the final scope. We review those details and discuss any adjustment before work begins.</p></details>
              <details><summary>Can I combine services?<span aria-hidden="true">+</span></summary><p>You can tell us which treatments interest you when you book or contact us. We confirm the combined scope, time and pricing rather than assume that one service includes another.</p></details>
              <details><summary>How should I prepare for my visit?<span aria-hidden="true">+</span></summary><p>Remove valuables and loose belongings, share any specific concerns, and tell us about existing coatings or recent paintwork. Each service page includes more specific preparation advice.</p></details>
            </div>
          </div>
        </section>

        <section className={styles.consultation}>
          <p className={styles.eyebrow}>YOUR CAR. YOUR PRIORITIES.</p><h2>Not sure where to begin?</h2>
          <p>Tell us what you drive and what you want to improve. We will help you find a sensible starting point.</p>
          <div className={styles.actions}><Link className={styles.primaryLink} href="/contact">Talk through your options <span aria-hidden="true">↗</span></Link><Link className={styles.lightTextLink} href="/booking">Explore appointments <span aria-hidden="true">↗</span></Link></div>
        </section>
      </div>
    </PageShell>
  );
}
