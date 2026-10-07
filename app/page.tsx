import Image from "next/image";
import Link from "next/link";
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
  ["Which detail should I choose?", "Choose Full Detail for interior and exterior care together. Interior Detail focuses on the cabin; Exterior Detail focuses on the body, wheels and glass. For heavier interior cleaning, explore Extensive Interior Detail."],
  ["Will detailing remove scratches?", "Cleaning removes dirt; paint correction uses machine polishing to improve suitable swirls, fine marks and haze. We inspect the paint and agree the scope first. Deep scratches may need a different repair."],
  ["What does ceramic coating do?", "It adds protection, gloss and water repellency to prepared paint, making routine cleaning easier. It does not remove scratches or prevent stone chips. We discuss preparation and aftercare with you."],
  ["Is the listed price the final price?", "Prices are based on a sedan. Vehicle size, condition and the work needed can affect the final price. Any additional work is discussed before we begin."],
  ["What happens after I book?", "Choose a service, add your vehicle and select a time. Your confirmation shows your booking and payment status. Consultation services are reviewed with you before the scope and appointment are confirmed."],
];

export default async function Home() {
  const { business, services, reviews } = await publicData();
  const coating = services.find((s) => s.slug === "ceramic-coating");
  const fullDetail = services.find((s) => s.slug === "full-detail");
  const detailing = ["interior-detail", "exterior-detail"].flatMap((slug) => services.filter((s) => s.slug === slug));
  const featured = [
    { slug: "full-detail", purpose: "Choose your detail", copy: "Interior, exterior or full detailing. Choose the care your car needs.", image: "/brand/photos/green-car-foam.webp", imageAlt: "Green sports car covered in wash foam", displayPrice: "Detail from $250" },
    { slug: "paint-correction", purpose: "Improve the paint", copy: "Polishing to reduce light swirls, haze and fine marks.", image: "/brand/photos/paint-beading.webp", imageAlt: "Water beading on black paint beside a microfiber towel" },
    { slug: "ceramic-coating", purpose: "Protect the finish", copy: "Prepared paint, lasting gloss and easier upkeep.", image: "/brand/photos/paint-beading.webp", imageAlt: "Water droplets on a black vehicle’s protected finish" },
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
          <p>Everyday dust, road grime and the places a quick wash misses. Choose interior care, an exterior detail or both together, so your car gets the attention it needs.</p>
          <div className={styles.detailingPrice}><strong>Detail from $250</strong><span>Interior · Exterior · Full detail</span></div>
          <div className={styles.links}><Link className="button" href="/booking">Choose your detail</Link><Link className="text-link" href="/services#all-services">Compare details</Link></div>
          {detailing.length > 0 && <div className={styles.focusedDetails}><p>Only need one area?</p>{detailing.map((service) => <Link key={service.id} href={`/services/${service.slug}`}><span>{service.name}</span><strong>{servicePrice(service)}</strong></Link>)}</div>}
        </div>
      </section>}
      {coating && <section className={`${styles.coating} wrap`} id="ceramic-coating">
        <div className={styles.featureHeading}>
          <p className="eyebrow">CERAMIC COATING</p><h2>Love the finish?<br /><em>Help protect it.</em></h2>
          <p>Add gloss and a water-repellent surface after the paint is properly prepared. We’ll assess your car, explain any correction it needs and agree the scope before coating.</p>
          <div className={styles.featurePrice}><span>{servicePrice(coating)}</span><small>Preparation and vehicle condition guide the final scope.</small></div>
          <div className={styles.links}><Link className="button" href={coatingBooking}>Request a consultation</Link><Link className="text-link" href="/services/ceramic-coating">See coating details</Link></div>
        </div>
        <div className={styles.featureVisual}><CeramicFilm /></div>
      </section>}
      <section className={`${styles.process} wrap`} id="process">
        <div className={styles.processImage}><Image src="/brand/photos/interior-cleaning.webp" alt="Detailer brushing and cleaning an interior door panel" fill sizes="(max-width: 760px) 100vw, 44vw" /></div>
        <div className={styles.processCopy}><p className="eyebrow">OUR PROCESS</p><h2>The finish matters.<br /><em>So does the process.</em></h2><p>Premium care should feel clear from the first conversation to the first drive home.</p>
          {[["01", "Understand your vehicle", "Tell us what you want cleaned or improved. We help you choose the right service."], ["02", "Agree the details", "We confirm the price and what is included before work begins."], ["03", "Finish. Inspect. Advise.", "We check the completed work, then share simple aftercare advice."]].map(([n, title, body]) => <div className={styles.processStep} key={n}><span>{n}</span><div><h3>{title}</h3><p>{body}</p></div></div>)}
          <Link className="text-link" href="/contact">Ask about your vehicle</Link>
        </div>
      </section>
      <section className={styles.detailStrip} aria-label="Attention to every surface">
        <figure><Image src="/brand/photos/wheel-cleaning.webp" alt="Detailer cleaning an alloy wheel with a soft brush" fill sizes="(max-width: 760px) 100vw, 50vw" /><figcaption><span>EVERY SURFACE</span><h3>Nothing gets overlooked.</h3></figcaption></figure>
        <figure><Image src="/brand/photos/mercedes-interior.webp" alt="Clean Mercedes cabin with white leather seats" fill sizes="(max-width: 760px) 100vw, 50vw" /><figcaption><span>THE DRIVE HOME</span><h3>Care you feel, every day.</h3></figcaption></figure>
      </section>
      {reviews.length > 0 && <section className={`${styles.reviews} wrap`}><p className="eyebrow">FROM THE DRIVER’S SEAT</p><h2>Good care gets remembered.</h2><div>{reviews.slice(0, 3).map((r) => <blockquote key={r.id}><span aria-label={`${r.rating} out of 5 stars`}>{"★".repeat(r.rating)}</span><p>“{r.text}”</p><cite>{r.name}</cite><small>Verified appointment</small></blockquote>)}</div></section>}
      <section className={`${styles.faq} wrap`}><div><p className="eyebrow">BEFORE YOU BOOK</p><h2>Answers before your appointment.</h2><p>Not sure where to start? Tell us about your vehicle and we’ll help you choose.</p><Link className="text-link" href="/contact">Ask the studio</Link></div><div className={styles.questions}>{questions.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>
      <section className={styles.location}><div className="wrap"><div><p className="eyebrow">WEST LOOP, CHICAGO</p><h2>Premium care, close to home.</h2></div><div><p>{business.service_area}</p><p>{business.address || "Your appointment location is confirmed before your visit."}</p><span>{business.hours_label}</span><Link className="text-link" href="/contact">Plan your visit</Link></div></div></section>
    </PageShell>
  );
}
