import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { heroVideoMedia, mobileHeroMediaQuery } from "@/components/westloop/hero-media";
import { publicData } from "@/lib/platform/public";
import { servicePrice } from "@/lib/service-content";
import { siteUrl } from "@/lib/platform/settings";
import { openingHoursSpecification } from "@/lib/platform/business-hours";
import { PageShell } from "@/components/westloop/PageShell";
import { CinematicHero } from "@/components/westloop/CinematicHero";
import { CeramicFilm } from "@/components/westloop/CeramicFilm";
import styles from "./Home.module.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: { absolute: "West Loop Ceramics | Car Detailing, Paint Correction & Coating" },
  description: "Interior and exterior car detailing, paint correction and ceramic coating in Chicago’s West Loop. Compare services and prices, then book your visit.",
  alternates: { canonical: "/" },
};

const questions = [
  { question: "Which detail should I choose?", teaser: "Match the service to the part of the car that needs attention.", answer: "Choose Interior Detail for the cabin, Exterior Detail for the body, wheels and glass, or Full Detail when both need care in one visit. Extensive Interior Detail is the better fit for embedded dirt, pet hair or heavier condition work. If you are unsure, tell us what bothers you most and we will guide you." },
  { question: "Will detailing remove scratches?", teaser: "Cleaning and paint correction solve different problems.", answer: "Detailing removes contamination and restores a clean finish, but it does not erase scratches. Paint correction uses measured machine polishing to reduce suitable swirls, haze and fine marks. We inspect the paint first, explain what can improve safely and set realistic expectations before work begins." },
  { question: "What does ceramic coating do?", teaser: "It protects prepared paint and makes routine care easier.", answer: "Ceramic coating adds gloss, water repellency and a durable sacrificial layer to properly prepared paint. It can make future washing easier, but it does not remove defects, prevent stone chips or make a car maintenance-free. Preparation and aftercare are confirmed during your consultation." },
  { question: "Is the listed price the final price?", teaser: "You see the starting point before you reserve your visit.", answer: "Displayed prices are based on the listed vehicle size and service scope. Larger vehicles, condition concerns and requested upgrades can change the estimate. You will see the booking estimate before submitting, and we discuss any condition-based adjustment before starting additional work." },
  { question: "What happens after I book?", teaser: "Choose your care, reserve a time and receive a clear confirmation.", answer: "After you select a service, vehicle and available time, we create your appointment and show its booking and payment status. If a deposit is required, secure checkout follows. Consultation services are reviewed with you before the final scope, price and timing are confirmed." },
];

export default async function Home() {
  const [{ business, services, reviews }, requestHeaders] = await Promise.all([publicData(), headers()]);
  const mobileAnimation = heroVideoMedia?.mobileAnimation ?? heroVideoMedia?.animation;
  const coating = services.find((s) => s.slug === "ceramic-coating");
  const fullDetail = services.find((s) => s.slug === "full-detail");
  const detailing = ["interior-detail", "exterior-detail"].flatMap((slug) => services.filter((s) => s.slug === slug));
  const featured = [
    { slug: "full-detail", purpose: "Choose your detail", copy: "Interior, exterior or complete care built around what your vehicle needs today.", image: "/brand/photos/green-car-foam.webp", imageAlt: "Green sports car covered in wash foam", displayPrice: "From $250" },
    { slug: "paint-correction", purpose: "Improve the paint", copy: "Measured machine polishing for suitable swirls, haze and fine marks.", image: "/brand/photos/paint-beading.webp", imageAlt: "Water beading on black paint beside a microfiber towel" },
    { slug: "ceramic-coating", purpose: "Protect the finish", copy: "Prepared paint, richer gloss and easier maintenance with lasting protection.", image: "/brand/photos/mercedes-foam.webp", imageAlt: "Black Mercedes covered in foam during coating preparation" },
  ].flatMap((item) => {
    const service = services.find((s) => s.slug === item.slug);
    return service ? [{ ...item, service }] : [];
  });
  const coatingBooking = coating ? `/booking?service=${coating.id}` : "/contact";
  const schema = {
    "@context": "https://schema.org", "@type": "AutomotiveBusiness",
    name: business.name, url: siteUrl(), areaServed: "Chicago, Illinois",
    openingHoursSpecification: openingHoursSpecification(business),
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
      <section className={styles.quickServices} id="detailing" aria-labelledby="choose-care-heading"><div className="wrap" id="services">
        <div className={styles.quickHeading}><div><p className="eyebrow">YOUR CAR. THE RIGHT CARE.</p><h2 id="choose-care-heading">What does your car need?</h2></div><Link className="text-link" href="/services">All services &amp; prices</Link></div>
        <div className={styles.quickGrid}>{featured.map(({ purpose, copy, image, imageAlt, displayPrice, service }) => <article className={styles.quickCard} key={service.id}>
          <div className={styles.quickMedia}><Image src={image} alt={imageAlt} fill sizes="(max-width: 760px) 100vw, 33vw" /></div>
          <div className={styles.quickCardBody}>
            <p className={styles.purpose}>{purpose}</p><h3>{service.slug === "full-detail" ? "Detailing" : service.name}</h3><p>{copy}</p>
            <div className={styles.quickPrice}><strong>{displayPrice ?? servicePrice(service)}</strong><Link href={service.slug === "full-detail" ? "/services#all-services" : `/services/${service.slug}`}>See details</Link></div>
            <Link className={`button small ${styles.quickBook}`} href={service.slug === "full-detail" ? "/booking" : `/booking?service=${encodeURIComponent(service.id)}`}>{service.slug === "full-detail" ? "Choose your detail" : service.slug === "ceramic-coating" || service.pricing_mode === "quote" ? "Request a consultation" : `Book ${service.name.toLowerCase()}`}</Link>
          </div>
        </article>)}</div>
      </div></section>
      {fullDetail && <section className={`${styles.detailingFeature} wrap`} id="full-detail" aria-labelledby="detailing-heading">
        <div className={styles.detailingImage}><Image src="/brand/photos/hand-wash.webp" alt="Detailer hand washing a black car with a sponge" fill sizes="(max-width: 760px) 100vw, 48vw" /></div>
        <div className={styles.detailingCopy}><p className="eyebrow">DETAILING, YOUR WAY</p><h2 id="detailing-heading">A clean cabin.<br /><em>A fresh exterior.</em></h2>
          <p>From the cabin you touch every day to the paint, glass and wheels outside, choose focused care or bring everything together in one visit. We make the differences clear before you book.</p>
          <div className={styles.detailingPrice}><strong>From $250</strong><span>Interior · Exterior · Full detail</span></div>
          <div className={styles.links}><Link className="button" href="/booking">Choose your detail</Link><Link className="text-link" href="/services#all-services">Compare details</Link></div>
          {detailing.length > 0 && <div className={styles.focusedDetails}><p>Only need one area?</p>{detailing.map((service) => <Link key={service.id} href={`/services/${service.slug}`}><span>{service.name}</span><strong>{servicePrice(service)}</strong></Link>)}</div>}
        </div>
      </section>}
      {coating && <section className={`${styles.coating} wrap`} id="ceramic-coating">
        <div className={styles.featureHeading}>
          <p className="eyebrow">CERAMIC COATING</p><h2>Love the finish?<br /><em>Help protect it.</em></h2>
          <p>Ceramic coating starts with preparation. We assess the paint, explain any refinement it needs, then build a protected, high-gloss finish that is easier to maintain.</p>
          <div className={styles.featurePrice}><span>{servicePrice(coating)}</span><small>Preparation and vehicle condition guide the final scope.</small></div>
          <div className={styles.links}><Link className="button" href={coatingBooking}>Request a consultation</Link><Link className="text-link" href="/services/ceramic-coating">See coating details</Link></div>
        </div>
        <div className={styles.featureVisual}><CeramicFilm /></div>
      </section>}
      <section className={`${styles.process} wrap`} id="process">
        <div className={styles.processImage}><Image src="/brand/photos/interior-cleaning.webp" alt="Detailer brushing and cleaning an interior door panel" fill sizes="(max-width: 760px) 100vw, 44vw" /></div>
        <div className={styles.processCopy}><p className="eyebrow">OUR PROCESS</p><h2>The finish matters.<br /><em>So does the process.</em></h2><p>A premium result begins with a clear plan. You know what we are doing, what it costs and how to care for the finish afterward.</p>
          {[["01", "Understand your vehicle", "Share the condition, your priorities and how the car is used. We recommend the service that fits."], ["02", "Confirm the scope", "We review the selected work, timing and price before any condition-based extras are added."], ["03", "Finish and inspect", "We complete a final quality check with you and provide straightforward aftercare guidance."]].map(([n, title, body]) => <div className={styles.processStep} key={n}><span>{n}</span><div><h3>{title}</h3><p>{body}</p></div></div>)}
          <Link className="text-link" href="/contact">Ask about your vehicle</Link>
        </div>
      </section>
      <section className={styles.detailStrip} aria-label="Attention to every surface">
        <figure><Image src="/brand/photos/wheel-cleaning.webp" alt="Detailer cleaning an alloy wheel with a soft brush" fill sizes="(max-width: 760px) 100vw, 50vw" /><figcaption><span>EVERY SURFACE</span><h3>Nothing gets overlooked.</h3></figcaption></figure>
        <figure><Image src="/brand/photos/mercedes-interior.webp" alt="Clean Mercedes cabin with white leather seats" fill sizes="(max-width: 760px) 100vw, 50vw" /><figcaption><span>THE DRIVE HOME</span><h3>Care you feel, every day.</h3></figcaption></figure>
      </section>
      {reviews.length > 0 && <section className={`${styles.reviews} wrap`}><p className="eyebrow">FROM THE DRIVER’S SEAT</p><h2>Good care gets remembered.</h2><div>{reviews.slice(0, 3).map((r) => <blockquote key={r.id}><span aria-label={`${r.rating} out of 5 stars`}>{"★".repeat(r.rating)}</span><p>“{r.text}”</p><cite>{r.name}</cite><small>Verified appointment</small></blockquote>)}</div></section>}
      <section className={`${styles.faq} wrap`}><div><p className="eyebrow">BEFORE YOU BOOK</p><h2>Answers before your appointment.</h2><p>Know what each service does, what affects the price and what happens after you reserve your time.</p><Link className="text-link" href="/contact">Ask the studio</Link></div><div className={styles.questions}>{questions.map(({ question, teaser, answer }, index) => <details key={question} open={index === 0}><summary><span className={styles.questionText}><strong>{question}</strong><small>{teaser}</small></span><span className={styles.faqToggle} aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>
      <section className={styles.location}><div className="wrap"><div><p className="eyebrow">WEST LOOP, CHICAGO</p><h2>Premium care, close to home.</h2></div><div><p>Appointment-based detailing for drivers across {business.service_area || "Chicago and the surrounding neighborhoods"}.</p><p>{business.address || "Your studio location and arrival details are confirmed with your appointment."}</p><span>{business.hours_label}</span><Link className="text-link" href="/contact">Plan your visit</Link></div></div></section>
    </PageShell>
  );
}
