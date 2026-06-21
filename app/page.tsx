import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { BookingForm } from "@/components/booking/BookingForm";
import { Nav } from "@/components/Nav";
import { ServiceMenu } from "@/components/ServiceMenu";
import { getPricedServices } from "@/lib/servicePricingStore";
import { serviceAreas, siteConfig } from "@/lib/siteConfig";
import { buildServiceTiers, galleryImages, processSteps, reasons, testimonials } from "@/lib/siteData";

export const dynamic = "force-dynamic";

const proofPoints = [
  ["Mobile luxury", "Premium detailing without driving across LA traffic."],
  ["Clear pricing", "Transparent packages with premium add-ons when you need them."],
  ["High-touch service", "Daily drivers, SUVs, trucks, luxury cars, and exotics handled carefully."],
  ["Fast rebooking", "Built for one-time refreshes and recurring maintenance plans."],
];

const faqItems = [
  ["Do you service all of Los Angeles?", "Yes. We come to you anywhere in LA and regularly serve Beverly Hills, Santa Monica, West Hollywood, Glendale, Pasadena, Culver City, Long Beach, Burbank, Sherman Oaks, and Malibu."],
  ["Do I need to provide water or power?", "We confirm setup details before the appointment so we can match the location and service correctly."],
  ["How long does a detail take?", "Most appointments take 2 to 5 hours depending on vehicle size, condition, and the package you choose."],
  ["How does monthly maintenance pricing work?", "Monthly maintenance service pricing is discussed after vehicle condition, parking setup, and schedule frequency are reviewed."],
];

export default async function Home() {
  const pricedServices = await getPricedServices();
  const services = buildServiceTiers(pricedServices);
  const premiumServices = services.filter((service) => service.category !== "Detailing");

  return (
    <main className="overflow-hidden bg-smoke">
      <Nav />
      <Hero />
      <Booking pricedServices={pricedServices} />
      <ProofStrip />
      <FeaturedServices services={services} />
      <Difference />
      <Gallery />
      <PremiumServices services={premiumServices} />
      <Process />
      <Testimonials />
      <ServiceArea />
      <Faq />
      <ContactFooter />
    </main>
  );
}

function Hero() {
  return (
    <section className="relative min-h-screen overflow-hidden px-4 pb-16 pt-28 text-white md:pt-36" id="top">
      <div className="absolute inset-0">
        <Image
          src="/brand/detailx-work/black-porsche-studio.jpg"
          alt="Luxury sports car prepared for a premium DETAILX LA detail"
          fill
          priority
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(16,19,27,0.97)_0%,rgba(16,19,27,0.88)_36%,rgba(16,19,27,0.42)_68%,rgba(16,19,27,0.72)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(240,123,70,0.36),transparent_24rem)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_84%_20%,rgba(150,211,248,0.18),transparent_22rem)]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-smoke to-transparent" />
      </div>

      <div className="content-shell relative grid min-h-[calc(100vh-9rem)] items-end">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-end">
          <div className="max-w-5xl pb-4">
            <p className="eyebrow">{siteConfig.brandName} / {siteConfig.city} mobile detailing</p>
            <h1 className="mt-5 max-w-5xl text-5xl font-black uppercase leading-[0.84] tracking-normal sm:text-7xl lg:text-8xl">
              Premium mobile detailing in Los Angeles.
            </h1>
            <p className="mt-7 max-w-3xl text-lg leading-8 text-ash md:text-xl">
              We come to you anywhere in LA with premium detailing for daily drivers, luxury cars, SUVs, trucks, and exotics. Clean booking, careful work, and a finish that feels Beverly Hills ready.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a className="rounded-lg bg-red px-7 py-4 text-center font-black text-white shadow-[0_20px_55px_rgba(240,123,70,0.38)] transition hover:-translate-y-0.5 hover:bg-red-dark" href="#booking">
                Book Detail
              </a>
              <a className="rounded-lg border border-white/25 bg-white/10 px-7 py-4 text-center font-black text-white backdrop-blur transition hover:-translate-y-0.5 hover:bg-white/[0.15]" href="#services">
                View Packages
              </a>
            </div>
            <div className="mt-8 flex flex-wrap gap-2">
              {serviceAreas.slice(0, 6).map((area) => (
                <span className="rounded-full border border-white/12 bg-white/8 px-4 py-2 text-xs font-black uppercase tracking-[0.1em] text-ash" key={area}>
                  {area}
                </span>
              ))}
            </div>
          </div>

          <aside className="rounded-[1.75rem] border border-white/[0.14] bg-ink/[0.74] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.42)] backdrop-blur">
            <p className="text-sm font-black uppercase text-red">LA route coverage</p>
            <p className="mt-4 text-3xl font-black uppercase leading-none">Sunshine gloss. Concierge convenience. No shop detour.</p>
            <div className="mt-6 grid gap-3">
              {[
                "Homes, condos, offices, and garages",
                "Luxury and exotic-friendly presentation",
                "Monthly maintenance plans available",
              ].map((item) => (
                <div className="flex items-center gap-3 border-t border-white/10 pt-3" key={item}>
                  <span className="h-2 w-2 rounded-full bg-red" />
                  <span className="text-sm font-bold text-ash">{item}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 grid gap-3 rounded-2xl bg-white/6 p-4">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-red-soft">Best fit</p>
              <p className="text-sm leading-7 text-ash">
                Exterior Detail, Interior Full Detail, Full Detail, Deep Detail, Paint Correction, Ceramic Coating, Headlight Restoration, and Monthly Maintenance Service.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

function ProofStrip() {
  return (
    <section className="content-shell relative z-10 -mt-10 grid overflow-hidden rounded-[1.6rem] border border-white/10 bg-ink text-white shadow-[0_24px_90px_rgba(16,19,27,0.34)] md:grid-cols-4">
      {proofPoints.map(([title, description]) => (
        <article className="border-white/10 p-6 md:border-r md:last:border-r-0" key={title}>
          <p className="font-black uppercase">{title}</p>
          <p className="mt-2 text-sm leading-6 text-ash">{description}</p>
        </article>
      ))}
    </section>
  );
}

function FeaturedServices({ services }: { services: Parameters<typeof ServiceMenu>[0]["services"] }) {
  return (
    <section className="section-pad content-shell" id="services">
      <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-end">
        <div>
          <p className="eyebrow">Detailing menu</p>
          <h2 className="mt-4 text-4xl font-black uppercase leading-none md:text-6xl">Packages built for LA drivers who notice the finish.</h2>
        </div>
        <p className="max-w-2xl text-lg leading-8 text-steel">
          Keep the same proven booking flow and service structure, but with a more premium Los Angeles presentation. Choose the package that fits your vehicle, then reserve your time in a few taps.
        </p>
      </div>
      <ServiceMenu services={services} />
    </section>
  );
}

function Difference() {
  return (
    <section className="section-pad bg-white" id="about">
      <div className="content-shell grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
        <div className="relative min-h-[560px] overflow-hidden rounded-[1.75rem] bg-ink">
          <Image
            src="/brand/detailx-work/matte-green-bmw.jpg"
            alt="Luxury SUV after premium mobile detailing in Los Angeles"
            fill
            className="object-cover opacity-[0.88]"
            sizes="(min-width: 1024px) 50vw, 100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-ink via-transparent to-transparent" />
          <div className="absolute bottom-5 left-5 right-5 rounded-[1.4rem] border border-white/[0.15] bg-ink/80 p-5 text-white backdrop-blur">
            <p className="text-sm font-black uppercase text-red">Service area</p>
            <p className="mt-2 text-2xl font-black uppercase leading-none">Los Angeles homes, condos, offices, garages, and approved parking setups.</p>
          </div>
        </div>

        <div>
          <p className="eyebrow">The DetailX LA difference</p>
          <h2 className="mt-4 text-4xl font-black uppercase leading-none md:text-6xl">Clean luxury with a west coast feel.</h2>
          <p className="mt-6 text-lg leading-8 text-steel">
            {siteConfig.brandName} is built for drivers who want more than a basic wash. We focus on gloss, interior reset, premium presentation, and a booking experience that feels sharp from the first click.
          </p>
          <div className="mt-8 grid gap-4">
            {reasons.map((reason) => (
              <article className="grid gap-4 rounded-[1.4rem] border border-ink/10 bg-smoke p-5 md:grid-cols-[190px_1fr]" key={reason.title}>
                <h3 className="font-black uppercase leading-none text-ink">{reason.title}</h3>
                <p className="leading-7 text-steel">{reason.description}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Gallery() {
  return (
    <section className="section-pad bg-ink text-white" id="work">
      <div className="content-shell">
        <div className="mb-8 flex flex-col gap-3 md:mb-10 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="eyebrow">Recent work</p>
            <h2 className="mt-3 text-4xl font-black uppercase leading-none md:text-6xl">Luxury-ready results.</h2>
          </div>
          <p className="max-w-sm text-sm font-bold uppercase tracking-[0.08em] text-ash">Gloss, cabin reset, paint clarity, and clean presentation for LA roads.</p>
        </div>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {galleryImages.map((image) => (
            <figure className="group overflow-hidden rounded-[1.35rem] border border-white/10 bg-white/5 shadow-[0_22px_65px_rgba(0,0,0,0.24)]" key={image.src}>
              <div className="relative aspect-[4/3] overflow-hidden">
                <Image
                  src={image.src}
                  alt={image.alt}
                  fill
                  className="object-cover transition duration-500 ease-out group-hover:scale-[1.035]"
                  style={{ objectPosition: image.objectPosition }}
                  sizes="(min-width: 1024px) 30vw, (min-width: 768px) 45vw, 100vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/12 to-transparent opacity-85 transition duration-300 group-hover:opacity-100" />
              </div>
              <figcaption className="flex items-center justify-between gap-4 border-t border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] px-4 py-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black uppercase tracking-[0.12em] text-white">{image.title}</p>
                  <p className="mt-1 truncate text-xs font-bold uppercase tracking-[0.08em] text-ash">{image.detail}</p>
                </div>
                <span className="shrink-0 rounded-full border border-white/12 bg-white/8 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-red-soft">
                  {siteConfig.brandName}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

function PremiumServices({ services }: { services: ReturnType<typeof buildServiceTiers> }) {
  return (
    <section className="section-pad bg-smoke">
      <div className="content-shell grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div>
          <p className="eyebrow">Premium services</p>
          <h2 className="mt-4 text-4xl font-black uppercase leading-none md:text-6xl">Correction, protection, and specialty care.</h2>
          <p className="mt-5 max-w-xl text-lg leading-8 text-steel">
            Paint Correction, Ceramic Coating, Headlight Restoration, and Monthly Maintenance Service are built for clients who want more than a one-time cleanup.
          </p>
        </div>
        <div className="grid gap-4">
          {services.map((service) => (
            <article className="rounded-[1.45rem] border border-ink/10 bg-white p-5 shadow-[0_22px_60px_rgba(16,19,27,0.08)]" key={service.title}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-red">{service.code}</p>
                  <h3 className="mt-2 text-2xl font-black uppercase leading-none">{service.title}</h3>
                </div>
                <p className="rounded-full bg-red-soft px-3 py-2 text-sm font-black uppercase text-red">{service.price}</p>
              </div>
              <p className="mt-4 leading-7 text-steel">{service.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Process() {
  return (
    <section className="section-pad bg-white" id="process">
      <div className="content-shell">
        <div className="max-w-3xl">
          <p className="eyebrow">Process</p>
          <h2 className="mt-4 text-4xl font-black uppercase leading-none md:text-6xl">A premium detail that fits the city.</h2>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-4">
          {processSteps.map((step) => (
            <article className="rounded-[1.35rem] bg-smoke p-6 soft-ring" key={step.title}>
              <p className="text-sm font-black text-red">{step.step}</p>
              <h3 className="mt-14 text-2xl font-black uppercase leading-none">{step.title}</h3>
              <p className="mt-4 leading-7 text-steel">{step.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Testimonials() {
  const carouselReviews = [...testimonials, ...testimonials];

  return (
    <section className="section-pad bg-[linear-gradient(180deg,#fff7f0,#ffece1)]" id="reviews">
      <div className="content-shell">
        <div className="grid gap-6 md:grid-cols-[0.8fr_1.2fr] md:items-end">
          <div>
            <p className="eyebrow">Reviews</p>
            <h2 className="mt-4 text-4xl font-black uppercase leading-none md:text-6xl">The kind of service people rebook.</h2>
          </div>
          <p className="text-lg leading-8 text-steel">Short notes from Los Angeles clients who wanted clean work, strong communication, and a more premium result.</p>
        </div>
        <div className="mt-12 overflow-hidden">
          <div className="testimonial-track flex w-max gap-4">
            {carouselReviews.map((review, index) => (
              <article className="w-[290px] shrink-0 rounded-[1.35rem] bg-ink p-6 text-white md:w-[360px]" key={`${review.name}-${index}`}>
                <p className="text-lg leading-8 text-ash">&quot;{review.quote}&quot;</p>
                <p className="mt-8 font-black uppercase">{review.name}</p>
                <p className="text-sm text-red">{review.neighborhood}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Booking({ pricedServices }: { pricedServices: Awaited<ReturnType<typeof getPricedServices>> }) {
  return (
    <section className="section-pad bg-[linear-gradient(135deg,var(--ink),var(--charcoal))] text-white" id="booking">
      <div className="content-shell grid min-w-0 gap-10 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
        <div className="min-w-0">
          <div className="mb-5 inline-flex rounded-full border border-red/45 bg-red/15 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-red-soft">
            Book 2 details and get a free wax
          </div>
          <p className="eyebrow">Reservations</p>
          <h2 className="mt-4 text-4xl font-black uppercase leading-none md:text-6xl">Pick the package. We bring the detail.</h2>
          <p className="mt-6 leading-8 text-ash">
            Exterior Detail, Interior Full Detail, Full Detail, Deep Detail, premium correction and protection services, plus monthly maintenance plans with pricing discussed after vehicle condition and schedule.
          </p>
          <div className="mt-8 grid gap-3">
            {["We come to you anywhere in LA", "Luxury and exotic-friendly care", "Transparent package pricing", "Fast booking confirmation"].map((item) => (
              <div className="rounded-[1rem] border border-white/[0.12] bg-white/[0.08] px-4 py-3 text-sm font-black uppercase" key={item}>{item}</div>
            ))}
          </div>
        </div>
        <Suspense fallback={null}>
          <BookingForm initialServices={pricedServices} />
        </Suspense>
      </div>
    </section>
  );
}

function ServiceArea() {
  return (
    <section className="section-pad bg-white">
      <div className="content-shell rounded-[2rem] bg-[linear-gradient(135deg,rgba(240,123,70,0.14),rgba(150,211,248,0.14))] p-6 ring-1 ring-ink/10 md:p-10">
        <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-end">
          <div>
            <p className="eyebrow">Service areas</p>
            <h2 className="mt-4 text-4xl font-black uppercase leading-none md:text-6xl">We come to you anywhere in LA.</h2>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-steel">
              From Beverly Hills garages to Santa Monica parking structures, West Hollywood condos, Pasadena driveways, and Malibu coastal homes, we build the service around your location.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {serviceAreas.map((area) => (
              <div className="rounded-[1.2rem] bg-white px-4 py-4 text-sm font-black uppercase text-ink shadow-[0_18px_50px_rgba(16,19,27,0.08)]" key={area}>
                {area}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section className="section-pad bg-smoke" id="faq">
      <div className="content-shell grid gap-10 lg:grid-cols-[0.7fr_1.3fr]">
        <div>
          <p className="eyebrow">FAQ</p>
          <h2 className="mt-4 text-4xl font-black uppercase leading-none md:text-6xl">Questions before you book.</h2>
        </div>
        <div className="grid gap-3">
          {faqItems.map(([question, answer]) => (
            <details className="rounded-[1.3rem] bg-white p-5 ring-1 ring-ink/10" key={question}>
              <summary className="cursor-pointer font-black uppercase text-ink">{question}</summary>
              <p className="mt-4 leading-7 text-steel">{answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function ContactFooter() {
  return (
    <footer className="bg-ink px-4 py-10 text-white" id="contact">
      <div className="content-shell overflow-hidden rounded-[2rem] border border-white/[0.12] bg-[linear-gradient(145deg,rgba(36,49,74,0.96),rgba(16,19,27,1))] shadow-[0_28px_110px_rgba(0,0,0,0.44)]">
        <div className="grid gap-8 p-5 md:grid-cols-[1.05fr_0.75fr_0.75fr] md:p-8">
          <div>
            <a className="inline-flex items-center gap-3 font-black uppercase" href="#top">
              <span className="grid h-14 w-14 place-items-center overflow-hidden rounded-lg bg-white p-1.5 ring-1 ring-white/20">
                <Image src="/brand/detailx-logo.png" alt="DETAILX LA logo" width={48} height={48} className="h-full w-full object-contain" />
              </span>
              <span>
                <span className="block text-xl leading-none">{siteConfig.brandName}</span>
                <span className="mt-1 block text-xs font-black uppercase tracking-[0.14em] text-red">Premium mobile detailing</span>
              </span>
            </a>
            <p className="mt-6 max-w-xl text-lg font-black uppercase leading-none">Clean luxury detailing brought to your Los Angeles location.</p>
            <p className="mt-4 max-w-md leading-7 text-ash">Premium mobile car detailing for daily drivers, luxury cars, SUVs, trucks, and exotics across Los Angeles.</p>
            <a className="mt-6 inline-flex rounded-lg bg-red px-6 py-4 font-black uppercase text-white transition hover:bg-red-dark" href="#booking">Book Detail</a>
          </div>

          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-red">Contact</p>
            <div className="mt-4 grid gap-3 text-ash">
              {siteConfig.optionalPhone ? <a className="transition hover:text-white" href={`tel:${siteConfig.optionalPhone}`}>{siteConfig.optionalPhone}</a> : null}
              <a className="transition hover:text-white" href={`mailto:${siteConfig.businessEmail}`}>{siteConfig.businessEmail}</a>
              {siteConfig.optionalInstagramUrl ? (
                <a className="transition hover:text-white" href={siteConfig.optionalInstagramUrl} target="_blank" rel="noreferrer">
                  {siteConfig.optionalInstagramHandle}
                </a>
              ) : null}
              <p>Service areas: {serviceAreas.slice(0, 5).join(", ")}, and more.</p>
            </div>
          </div>

          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-red">Explore</p>
            <nav className="mt-4 grid gap-3 text-ash">
              <a className="transition hover:text-white" href="#services">Services</a>
              <a className="transition hover:text-white" href="#work">Results</a>
              <a className="transition hover:text-white" href="#reviews">Reviews</a>
              <a className="transition hover:text-white" href="#faq">FAQ</a>
              <Link className="transition hover:text-white" href="/privacy-notice">Privacy Notice</Link>
              <Link className="transition hover:text-white" href="/service-rules">Service Rules</Link>
            </nav>
          </div>
        </div>
        <div className="border-t border-white/10 px-5 py-4 text-sm font-bold text-ash md:flex md:items-center md:justify-between md:px-8">
          <p>&copy; {new Date().getFullYear()} {siteConfig.brandName}. All rights reserved.</p>
          <p className="mt-2 md:mt-0">{siteConfig.primaryTagline}.</p>
        </div>
      </div>
    </footer>
  );
}
