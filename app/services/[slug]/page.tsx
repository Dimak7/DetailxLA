import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { publicData } from "@/lib/platform/public";
import { PageShell } from "@/components/westloop/PageShell";
import { ServiceCards } from "@/components/westloop/ServiceCards";
import { CeramicFilm } from "@/components/westloop/CeramicFilm";
import { money } from "@/lib/platform/types";
import { siteUrl } from "@/lib/platform/settings";
import { BRAND_NAME } from "@/lib/brand";
import { careStages, getServiceContent, serviceDuration, servicePrice } from "@/lib/service-content";
import styles from "@/components/westloop/ServiceDetails.module.css";

export const dynamic = "force-dynamic";
const getPageData = cache(publicData);
type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const { services } = await getPageData();
  const service = services.find((item) => item.slug === slug);
  if (!service) notFound();
  const content = getServiceContent(service);
  return {
    title: `${service.name} in Chicago`, description: content.metadata,
    alternates: { canonical: `/services/${service.slug}` },
    openGraph: { title: `${service.name} in Chicago | ${BRAND_NAME}`, siteName: BRAND_NAME, type: "website", description: content.metadata, url: `/services/${service.slug}`, images: [{ url: content.image, alt: content.imageAlt }] },
  };
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  const d = await getPageData();
  const service = d.services.find((item) => item.slug === slug);
  if (!service) notFound();
  const content = getServiceContent(service);
  const bookingHref = `/booking?service=${encodeURIComponent(service.id)}`;
  const related = content.related.flatMap((relatedSlug) => d.services.filter((item) => item.slug === relatedSlug && item.id !== service.id)).slice(0, 3);
  const isCoating = service.slug === "ceramic-coating";
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Service", name: service.name, description: service.description, url: `${siteUrl()}/services/${service.slug}`, provider: { "@type": "AutomotiveBusiness", name: d.business.name, url: siteUrl() }, areaServed: "Chicago",
        ...(service.pricing_mode === "fixed" ? { offers: { "@type": "Offer", price: service.price_cents / 100, priceCurrency: "USD", url: `${siteUrl()}${bookingHref}` } } : service.pricing_mode === "starting" ? { offers: { "@type": "AggregateOffer", lowPrice: service.price_cents / 100, priceCurrency: "USD" } } : {}),
      },
      { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Services", item: `${siteUrl()}/services` }, { "@type": "ListItem", position: 2, name: service.name, item: `${siteUrl()}/services/${service.slug}` }] },
    ],
  };
  return (
    <PageShell business={d.business}>
      <div className={styles.page}>
        <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/services">Services</Link><span aria-hidden="true">/</span><span aria-current="page">{service.name}</span></nav>
        <section className={styles.detailHero}>
          <div className={styles.detailHeroCopy}>
            <p className={styles.eyebrow}>{content.eyebrow}</p><p className={styles.serviceName}>{service.name}</p><h1>{content.headline.split("\n").map((line, index) => <span key={line}>{index ? <em>{line}</em> : line}</span>)}</h1><p className={styles.lead}>{content.introduction}</p>
            <div className={styles.actions}><Link className={styles.primaryLink} href={bookingHref}>{service.pricing_mode === "quote" ? "Start your booking" : "Choose your appointment"}</Link><a className={styles.textLink} href="#the-treatment">Explore the treatment</a></div>
          </div>
          <figure className={styles.detailHeroImage}><Image src={content.image} alt={content.imageAlt} fill priority sizes="(max-width: 800px) 100vw, 45vw" style={{ objectPosition: content.imagePosition }} /><figcaption>FINISH & FORM <span>Editorial imagery</span></figcaption></figure>
        </section>
        <div className={styles.appointmentStrip}>
          <div><span>YOUR INVESTMENT</span><strong>{servicePrice(service)}</strong></div><div><span>APPOINTMENT ESTIMATE</span><strong>{serviceDuration(service.duration_minutes)}</strong></div><p>Scope confirmed for your vehicle.<br />{isCoating ? "Cure and collection timing discussed before application." : "Additional work discussed before we begin."}</p>
        </div>

        <section className={`${styles.section} ${styles.treatmentLayout}`} id="the-treatment" aria-labelledby="treatment-heading">
          <div><p className={styles.eyebrow}>THE TREATMENT</p><h2 id="treatment-heading">The details make<br /><em>the difference.</em></h2><p className={styles.bodyCopy}>{content.overview}</p><h3 className={styles.smallHeading}>Included in this service</h3><ul className={styles.inclusions}>{service.includes.map((item) => <li key={item}>{item}</li>)}</ul></div>
          <aside className={styles.fitPanel}><p className={styles.eyebrow}>IS THIS YOUR NEXT STEP?</p><h3>A good fit for</h3><ul>{content.bestFor.map((item) => <li key={item}>{item}</li>)}</ul><div className={styles.fitPricing}><h4>Clear scope. Considered care.</h4><p>{service.pricing_mode === "quote" ? "We discuss your vehicle, the work required and the price before confirming your service." : "Prices shown are for sedans. Condition and vehicle size can affect the final scope."}</p>{service.pricing_mode !== "quote" && <p className={styles.vehiclePrices}>{service.pricing_mode === "starting" ? "Starting prices: " : ""}SUV {money(service.price_cents + service.suv_extra_cents)} · Truck {money(service.price_cents + service.truck_extra_cents)}</p>}<Link className={styles.textLink} href="/contact">Discuss your vehicle</Link></div></aside>
        </section>

        <section className={styles.processSection} aria-labelledby="process-heading"><div className={styles.sectionHeading}><div><p className={styles.eyebrow}>A CONSIDERED PROCESS</p><h2 id="process-heading">Care, from start to finish.</h2></div><p>Every vehicle has a different starting point. The agreed scope guides the work.</p></div><ol className={styles.processGrid}>{content.process.map((step, index) => <li key={step.title}><span className={styles.stepNumber}>{String(index + 1).padStart(2, "0")}</span><h3>{step.title}</h3><p>{step.body}</p></li>)}</ol></section>

        {isCoating && <>
          <section className={`${styles.section} ${styles.filmLayout}`} aria-labelledby="film-heading"><CeramicFilm /><div><p className={styles.eyebrow}>BEYOND THE REFLECTION</p><h2 id="film-heading">Preparation is part<br /><em>of the finish.</em></h2><p className={styles.bodyCopy}>The coating is one part of the process. The surface beneath it, careful application and the first days of aftercare all deserve attention.</p><p className={styles.bodyCopy}>We discuss your paint, your priorities and any additional correction before confirming the work. You leave with guidance for looking after the finish.</p><Link className={styles.textLink} href="/contact">Discuss your coating options</Link></div></section>
          <section className={styles.section} aria-labelledby="coating-comparison-heading"><div className={styles.sectionHeading}><div><p className={styles.eyebrow}>THE RIGHT FOUNDATION</p><h2 id="coating-comparison-heading">Clean. Refine. Protect.</h2></div><p>A coating protects the prepared finish. It does not replace the steps that come before it.</p></div><div className={styles.comparison}>{careStages.map((stage) => <article className={styles.comparisonCard} key={stage.slug}><span className={styles.stepNumber}>{stage.number}</span><h3>{stage.title}</h3><p>{stage.detail}</p><p className={styles.comparisonNote}>{stage.boundary}</p>{stage.slug !== service.slug && d.services.some((item) => item.slug === stage.slug) && <Link className={styles.textLink} href={`/services/${stage.slug}`}>Explore {stage.service.toLowerCase()}</Link>}</article>)}</div></section>
        </>}

        <section className={styles.section} aria-labelledby="preparation-heading"><div className={styles.preparationLayout}><div><p className={styles.eyebrow}>BEFORE YOUR VISIT</p><h2 id="preparation-heading">A little preparation.<br /><em>A smoother visit.</em></h2></div><ol className={styles.preparationList}>{content.preparation.map((item) => <li key={item}>{item}</li>)}</ol></div></section>

        <section className={`${styles.section} ${styles.faqSection}`} aria-labelledby="faq-heading"><div className={styles.faqLayout}><div><p className={styles.eyebrow}>GOOD QUESTIONS</p><h2 id="faq-heading">Know what<br /><em>to expect.</em></h2><p className={styles.bodyCopy}>A clear understanding of the service is part of a good result.</p></div><div className={styles.faqs}>{content.faqs.map((faq) => <details key={faq.question}><summary>{faq.question}<span aria-hidden="true">+</span></summary><p>{faq.answer}</p></details>)}</div></div></section>

        <section className={styles.consultation}><p className={styles.eyebrow}>{service.name.toUpperCase()}</p><h2>Your next good decision.</h2><p>Choose a time and tell us about your car. We will confirm the details that matter before the work begins.</p><div className={styles.actions}><Link className={styles.primaryLink} href={bookingHref}>Book {service.name.toLowerCase()}</Link><Link className={styles.lightTextLink} href="/contact">Have a question?</Link></div></section>

        {related.length > 0 && <section className={styles.section} aria-labelledby="related-heading"><div className={styles.sectionHeading}><div><p className={styles.eyebrow}>CONTINUE THE CARE</p><h2 id="related-heading">Other ways to care for your car.</h2></div><Link className={styles.textLink} href="/services">View the full collection</Link></div><ServiceCards services={related} compact /></section>}
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} />
    </PageShell>
  );
}
