import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { heroVideoMedia, mobileHeroMediaQuery } from "@/components/westloop/hero-media";
import { publicData } from "@/lib/platform/public";
import { money } from "@/lib/platform/types";
import { siteUrl } from "@/lib/platform/settings";
import { PageShell } from "@/components/westloop/PageShell";
import { CinematicHero } from "@/components/westloop/CinematicHero";
import { ServiceCards } from "@/components/westloop/ServiceCards";
import { ServiceFinder } from "@/components/westloop/ServiceFinder";
import { CeramicFilm } from "@/components/westloop/CeramicFilm";
import styles from "./Home.module.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: { absolute: "West Loop Ceramics | Ceramic Coating & Detailing in Chicago" },
  description: "A better finish starts with thoughtful preparation. Discover ceramic coating, paint correction and premium detailing in Chicago’s West Loop. Explore services and book online.",
  alternates: { canonical: "/" },
};

const questions = [
  ["Is ceramic coating right for my car?", "It can be a good fit if you want enhanced gloss, water repellency and easier routine cleaning. We assess the paint first and recommend the preparation it needs. The right choice depends on the vehicle’s condition, how you use it and how you plan to maintain it."],
  ["Does my car need paint correction before coating?", "Coating protects the finish underneath it; it does not remove scratches or swirl marks. Paint correction may be recommended first to improve clarity. We discuss that work and the price before you commit."],
  ["Will ceramic coating prevent scratches and stone chips?", "Ceramic coating is not scratch-proof and does not replace paint protection film. Careful washing still matters. Its role is to add a protective surface and make ongoing care easier."],
  ["What will my appointment cost?", "Each service page shows the current price or starting price. Vehicle size, condition and preparation can change the final scope. Your booking shows an estimate, and any additional work is discussed before we begin."],
  ["What happens after I book?", "Choose your service, add your vehicle and select an available time. You’ll review the appointment before confirming. For coating, we also discuss preparation, curing and aftercare so you know what to expect."],
];

export default async function Home() {
  const [{ business, services, reviews }, requestHeaders] = await Promise.all([publicData(), headers()]);
  const mobileAnimation = heroVideoMedia?.mobileAnimation ?? heroVideoMedia?.animation;
  const coating = services.find((s) => s.slug === "ceramic-coating");
  const featured = ["ceramic-coating", "paint-correction", "full-detail"].flatMap((slug) => services.filter((s) => s.slug === slug));
  const coatingBooking = coating ? `/booking?service=${coating.id}` : "/contact";
  const schema = {
    "@context": "https://schema.org", "@type": "AutomotiveBusiness",
    name: business.name, url: siteUrl(), areaServed: "Chicago, Illinois",
    ...(business.phone ? { telephone: business.phone } : {}),
    ...(business.address ? { address: { "@type": "PostalAddress", streetAddress: business.address, addressLocality: "Chicago", addressRegion: "IL", addressCountry: "US" } } : {}),
  };
  return (
    <PageShell business={business}>
      {mobileAnimation && requestHeaders.get("save-data") !== "on" && (
        <link rel="preload" as="image" href={mobileAnimation.src} media={mobileHeroMediaQuery} fetchPriority="high" />
      )}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} />
      <CinematicHero />
      <section className={`${styles.coating} wrap`} id="ceramic-coating">
        <div className={styles.featureHeading}>
          <p className="eyebrow">CERAMIC COATING</p><h2>Exceptional gloss.<br /><em>Considered protection.</em></h2>
          <p className={styles.lead}>For the way it looks today.<br />And the way you care for it tomorrow.</p>
          <p>Ceramic coating brings a new depth to your paint and helps make regular washing easier. The difference starts before the coating touches the car: thoughtful preparation, a clean surface and attention to every panel.</p>
          <div className={styles.featurePrice}><span>{coating && coating.pricing_mode !== "quote" ? `${coating.pricing_mode === "starting" ? "From " : ""}${money(coating.price_cents)}` : "Tailored to your vehicle"}</span><small>Preparation and vehicle condition guide the final scope.</small></div>
          <div className={styles.links}><Link className="button" href={coatingBooking}>Book ceramic coating</Link><Link className="text-link" href="/services/ceramic-coating">See coating details</Link></div>
        </div>
        <div className={styles.featureVisual}><CeramicFilm /><div className={styles.benefits}>
          <div><h3>A richer finish</h3><p>Gloss and clarity that reward a closer look.</p></div>
          <div><h3>Easier upkeep</h3><p>A water-repellent surface for a simpler wash routine.</p></div>
          <div><h3>A considered plan</h3><p>Preparation and aftercare matched to your vehicle.</p></div>
        </div></div>
      </section>
      <section className={styles.services} id="services"><div className="wrap">
        <div className={styles.sectionHeading}><div><p className="eyebrow">SERVICES</p><h2>Refine. Protect.<br /><em>Enjoy the drive.</em></h2></div><div><p>From a complete detail to a carefully prepared coating, find the service that fits your car.</p><Link className="text-link" href="/services">View all {services.length} services</Link></div></div>
        <ServiceCards services={featured} compact />
        <ServiceFinder services={services.map(({ id, slug, name, price_cents, pricing_mode }) => ({ id, slug, name, price_cents, pricing_mode }))} />
      </div></section>
      <section className={`${styles.process} wrap`} id="process">
        <div className={styles.processImage}><Image src="/portfolio/black-porsche-studio.jpg" alt="Light tracing the contours of a polished black Porsche" fill sizes="(max-width: 760px) 100vw, 44vw" /></div>
        <div className={styles.processCopy}><p className="eyebrow">OUR PROCESS</p><h2>The finish matters.<br /><em>So does the process.</em></h2><p>Premium care should feel clear from the first conversation to the first drive home.</p>
          {[["01", "Understand your vehicle", "We start with the condition of the paint, the way you drive and the finish you want."], ["02", "Prepare with purpose", "A careful wash, decontamination and any agreed paint correction establish the right foundation."], ["03", "Finish. Inspect. Advise.", "We check the finish and explain the care it needs, including coating cure and maintenance guidance."]].map(([n, title, body]) => <div className={styles.processStep} key={n}><span>{n}</span><div><h3>{title}</h3><p>{body}</p></div></div>)}
          <Link className="text-link" href="/contact">Ask about your vehicle</Link>
        </div>
      </section>
      <section className={styles.detailStrip} aria-label="Attention to every surface">
        <figure><Image src="/portfolio/red-audi-light-detail.jpg" alt="Close-up of red paint and precise automotive lighting" fill sizes="(max-width: 760px) 100vw, 50vw" /><figcaption><span>PAINTWORK</span><h3>Depth in every reflection.</h3></figcaption></figure>
        <figure><Image src="/portfolio/tan-interior-detail.jpg" alt="Fine leather texture and detailed interior stitching" fill sizes="(max-width: 760px) 100vw, 50vw" /><figcaption><span>INTERIOR CARE</span><h3>Care you feel, every day.</h3></figcaption></figure>
      </section>
      {reviews.length > 0 && <section className={`${styles.reviews} wrap`}><p className="eyebrow">FROM THE DRIVER’S SEAT</p><h2>Good care gets remembered.</h2><div>{reviews.slice(0, 3).map((r) => <blockquote key={r.id}><span aria-label={`${r.rating} out of 5 stars`}>{"★".repeat(r.rating)}</span><p>“{r.text}”</p><cite>{r.name}</cite><small>Verified appointment</small></blockquote>)}</div></section>}
      <section className={`${styles.faq} wrap`}><div><p className="eyebrow">BEFORE YOU BOOK</p><h2>Answers before your appointment.</h2><p>Not sure where to start? Tell us about your vehicle and we’ll help you choose.</p><Link className="text-link" href="/contact">Ask the studio</Link></div><div className={styles.questions}>{questions.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>
      <section className={styles.location}><div className="wrap"><div><p className="eyebrow">WEST LOOP, CHICAGO</p><h2>Premium care, close to home.</h2></div><div><p>{business.service_area}</p><p>{business.address || "Your appointment location is confirmed before your visit."}</p><span>{business.hours_label}</span><Link className="text-link" href="/contact">Plan your visit</Link></div></div></section>
    </PageShell>
  );
}
