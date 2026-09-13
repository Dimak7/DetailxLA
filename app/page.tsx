import Image from "next/image";
import Link from "next/link";
import { publicData } from "@/lib/platform/public";
import { PageShell } from "@/components/westloop/PageShell";
import { CallLink } from "@/components/westloop/PublicShell";
import { ServiceCards } from "@/components/westloop/ServiceCards";
import { Gallery } from "@/components/westloop/Gallery";
import { siteUrl } from "@/lib/platform/settings";
export const dynamic = "force-dynamic";
export const metadata = { alternates: { canonical: "/" } };
export default async function Home() {
  const { business, services, gallery, reviews } = await publicData();
  const schema = {
    "@context": "https://schema.org",
    "@type": "AutomotiveBusiness",
    name: business.name,
    url: siteUrl(),
    areaServed: "Chicago, Illinois",
    ...(business.phone ? { telephone: business.phone } : {}),
    ...(business.address
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: business.address,
            addressLocality: "Chicago",
            addressRegion: "IL",
            addressCountry: "US",
          },
        }
      : {}),
  };
  return (
    <PageShell business={business}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(schema).replace(/</g, "\\u003c"),
        }}
      />
      <section className="hero wrap">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="dot" /> WEST LOOP / CHICAGO
          </p>
          <h1>
            Not just clean.
            <br />
            <em>Considered.</em>
          </h1>
          <p className="hero-description">
            Exceptional detailing. Thoughtful protection.
            <br />A fresh perspective on the car you love.
          </p>
          <div className="button-row">
            <Link href="/booking" className="button">
              Book your visit <span>↗</span>
            </Link>
            <CallLink phone={business.phone} className="text-link" />
          </div>
          <div className="hero-foot">
            <span>
              FOR THE DAILY DRIVE.
              <br />
              AND THE EXTRAORDINARY.
            </span>
            <a href="#services" aria-label="Explore our services">
              ↓
            </a>
          </div>
        </div>
        <div className="hero-visual">
          <Image
            src="/portfolio/silver-porsche-street.jpg"
            alt="Sculpted silver Porsche bodywork"
            fill
            priority
            sizes="(max-width: 760px) 100vw, 55vw"
          />
          <div className="image-label">
            THE ART OF AUTOMOTIVE CARE <span>01 / CHICAGO</span>
          </div>
          <span className="hero-seal">
            WEST LOOP
            <br />
            <i>the auto spa</i>
            <br />
            CHICAGO
          </span>
        </div>
      </section>
      <div className="principles wrap">
        <span>Care, down to the detail.</span>
        <p>Transparent service pricing</p>
        <p>Appointments that fit your day</p>
        <p>From daily drivers to exotics</p>
      </div>
      <section className="section wrap" id="services">
        <div className="section-heading">
          <div>
            <p className="eyebrow">THE SERVICE MENU</p>
            <h2>
              A little care.
              <br />
              <em>A remarkable difference.</em>
            </h2>
          </div>
          <div>
            <p>
              Choose a refresh, a full reset, or lasting protection.
              <br />
              We take care of the details.
            </p>
            <Link className="text-link" href="/services">
              Explore all services ↗
            </Link>
          </div>
        </div>
        <ServiceCards services={services.slice(0, 3)} compact />
      </section>
      <section className="approach wrap" id="approach">
        <div className="approach-photo">
          <Image
            src="/portfolio/tan-interior-detail.jpg"
            alt="Detailed leather interior craftsmanship"
            fill
            sizes="(max-width: 760px) 100vw, 45vw"
          />
        </div>
        <div className="approach-copy">
          <p className="eyebrow">THE WEST LOOP APPROACH</p>
          <h2>
            Your car.
            <br />
            <em>Our full attention.</em>
          </h2>
          <p>
            A great detail starts with understanding the vehicle in front of us.
            Its materials. Its condition. The way you use it.
          </p>
          <div className="numbered">
            <span>01</span>
            <div>
              <h3>Care, not shortcuts.</h3>
              <p>
                Purposeful treatments for paint, upholstery and every surface in
                between.
              </p>
            </div>
          </div>
          <div className="numbered">
            <span>02</span>
            <div>
              <h3>Clarity from the start.</h3>
              <p>
                Clear service inclusions and starting prices. Additional work is
                discussed before it begins.
              </p>
            </div>
          </div>
          <div className="numbered">
            <span>03</span>
            <div>
              <h3>Made for your everyday.</h3>
              <p>
                A considered service for cherished cars and the ones that do it
                all.
              </p>
            </div>
          </div>
        </div>
      </section>
      <section className="section wrap">
        <div className="section-heading">
          <div>
            <p className="eyebrow">THE FINISH</p>
            <h2>
              Details worth
              <br />
              <em>a closer look.</em>
            </h2>
          </div>
          <Link className="text-link" href="/gallery">
            View the gallery ↗
          </Link>
        </div>
        <Gallery items={gallery.slice(0, 6)} />
      </section>
      <section className="steps-section wrap">
        <p className="eyebrow">LESS EFFORT. MORE ENJOYMENT.</p>
        <h2>A better detail starts here.</h2>
        <div className="steps-grid">
          {[
            [
              "01",
              "Find your service",
              "Choose the care your car needs, with clear inclusions and pricing.",
            ],
            [
              "02",
              "Make it yours",
              "Tell us about your vehicle and choose a live appointment time.",
            ],
            [
              "03",
              "Leave it to us",
              "Receive your confirmation. We will take care of the rest.",
            ],
          ].map(([n, t, d]) => (
            <div key={n}>
              <span>{n}</span>
              <h3>{t}</h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="premium-panel wrap">
        <Image
          src="/portfolio/black-porsche-studio.jpg"
          alt="Glossy black sports car bodywork"
          fill
          sizes="100vw"
        />
        <div>
          <p className="eyebrow">BEYOND THE EVERYDAY</p>
          <h2>
            Protect the finish.
            <br />
            <em>Preserve the feeling.</em>
          </h2>
          <p>
            Discover paint correction and ceramic coating,
            <br />
            tailored to your vehicle's condition.
          </p>
          <Link className="button light" href="/services">
            Explore protection ↗
          </Link>
        </div>
      </section>
      <section className="section wrap reviews-section">
        <p className="eyebrow">CUSTOMER PERSPECTIVES</p>
        <h2>Good care speaks for itself.</h2>
        {reviews.length ? (
          <div className="review-grid">
            {reviews.slice(0, 3).map((r) => (
              <blockquote key={r.id}>
                <p aria-label={r.rating + " out of 5"}>
                  {"★".repeat(r.rating)}
                </p>
                <p>“{r.text}”</p>
                <cite>{r.name}</cite>
                <small>Verified appointment</small>
              </blockquote>
            ))}
          </div>
        ) : (
          <p className="muted">
            Our story is just beginning. Feedback from completed appointments
            will appear here. No borrowed reviews.
          </p>
        )}
      </section>
      <section className="location-section wrap">
        <div>
          <p className="eyebrow">IN GOOD COMPANY</p>
          <h2>
            Chicago roots.
            <br />
            <em>West Loop spirit.</em>
          </h2>
        </div>
        <div>
          <p>{business.service_area}</p>
          <p>
            {business.address ||
              "Appointment location is confirmed with your booking."}
          </p>
          <p>{business.hours_label}</p>
          <Link className="text-link" href="/contact">
            Plan your visit ↗
          </Link>
        </div>
      </section>
    </PageShell>
  );
}
