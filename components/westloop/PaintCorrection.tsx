"use client";

import Link from "next/link";
import Image from "next/image";
import { serviceDuration, servicePrice } from "@/lib/service-content";
import { servicePackages } from "@/lib/booking-options";
import { money, type Service } from "@/lib/platform/types";
import styles from "./PaintCorrection.module.css";
import serviceStyles from "./ServiceDetails.module.css";

const benefits = [
  { title: "Less visible swirling", text: "Refine the fine wash marks that catch the light, even when your car is clean." },
  { title: "Clearer reflections", text: "Reduce surface haze for a crisper, more defined reflection across the panels." },
  { title: "Deeper gloss", text: "Bring out the richness of the paint and the lines that made you love the car." },
];

const stages = [
  { title: "Assess the finish", subtitle: "Understand the paint. Agree the plan.", text: "We review visible marks, previous polishing or repairs, and the areas you care about most. We discuss what can improve, what should remain and the scope of work before starting." },
  { title: "Prepare the surface", subtitle: "A clean foundation for careful polishing.", text: "Washing and decontamination remove dirt and bonded contamination as required. This lets us assess the surface clearly and prepare it for machine polishing." },
  { title: "Refine the paint", subtitle: "The right approach, panel by panel.", text: "We select the polishing approach around the paint and agreed scope, inspecting the finish as the work progresses. The aim is a worthwhile improvement while respecting the limits of the surface." },
  { title: "Review & plan the care", subtitle: "Know your finish. Know what comes next.", text: "We review the finish, discuss any remaining marks and explain the care it needs next. Any additional protection is agreed for your vehicle, so you know how to look after the result." },
];

// Explain the legacy catalogue labels without replacing custom dashboard inclusions.
const bookingInclusionLabels = new Map([
  ["paint inspection", "A correction plan tailored to your paint"],
  ["finish inspection", "Aftercare advice to help preserve the gloss"],
]);

export function PaintCorrection({ service }: { service: Service }) {
  const booking = `/booking?service=${encodeURIComponent(service.id)}`;
  const correctionPackages = servicePackages("paint-correction");
  const questions = [
    { title: "How long will you need my car?", answer: `The current appointment estimate is ${serviceDuration(service.duration_minutes)}. Vehicle size, paint condition and the agreed correction can change that timing. We confirm drop-off and collection arrangements for your visit.` },
    { title: "Will every scratch disappear?", answer: "No. Deep scratches, stone chips and failing paint may need repair instead. Removing too much material to chase a mark can be the wrong choice. We explain the realistic improvement after inspecting your paint." },
    { title: "Is ceramic coating included?", answer: "Only when it is expressly included in your agreed scope. Correction refines the finish; ceramic coating is a separate protection service. We can discuss both together." },
    { title: "What should I tell you before booking?", answer: "Share your car’s make, model and the marks that bother you. Mention previous polishing, repainting, coatings, wraps or paint protection film. Photos help start the conversation, but the paint still needs an in-person assessment." },
  ];


  return <div className={`${serviceStyles.page} ${styles.page}`}>
    <section className={styles.hero} aria-labelledby="paint-title">
      <div className={styles.heroFilm}><Image src="/brand/photos/paint-beading.webp" alt="Water beading on black paint beside a microfiber towel" fill sizes="100vw" priority style={{ objectFit: "cover" }} /></div>
      <div className={styles.heroShade} aria-hidden="true" />
      <div className={styles.heroHeading}>
        <p className={styles.heroEyebrow}>WEST LOOP CERAMICS / CHICAGO</p>
        <h1 id="paint-title">Paint correction.</h1>
      </div>
      <div className={styles.heroBottom}>
        <div className={styles.heroCopy}>
          <p className={styles.heroLead}>Bring back the finish<br /><em>you fell for.</em></p>
          <p className={styles.heroDescription}>Still swirled or hazy after a wash?<br />Precision polishing brings back clarity and gloss.</p>
          <div className={styles.heroActions}><Link className="button light" href={booking}>Book paint correction</Link><a className="button outline on-dark" href="#the-craft">Discover the difference</a></div>
        </div>
        <div className={styles.heroControls}><span>YOUR FINISH, REFINED</span></div>
      </div>
    </section>
    <div className={serviceStyles.appointmentStrip}>
      <div><span>YOUR INVESTMENT</span><strong>{servicePrice(service)}</strong></div><div><span>APPOINTMENT ESTIMATE</span><strong>{serviceDuration(service.duration_minutes)}</strong></div><p>Scope confirmed for your vehicle.<br />Additional work discussed before we begin.</p>
    </div>

    <nav className={styles.sectionNav} aria-label="Paint correction guide"><span>YOUR GUIDE TO A BETTER FINISH</span><a href="#the-craft">The difference</a><a href="#your-correction">Options & pricing</a><a href="#your-visit">The process</a><a href="#paint-questions">Questions</a></nav>

    <section className={styles.craft} id="the-craft" aria-labelledby="craft-title">
      <div className={styles.craftHeading}><p className={styles.eyebrow}>01 / THE DIFFERENCE</p><h2 id="craft-title">Clean is the starting point.<br /><span>Clarity is the next step.</span></h2></div>
      <div className={styles.craftGrid}>
        <figure className={styles.processShowcase}>
          <div className={styles.processFilm}><Image src="/brand/photos/hand-wash.webp" alt="Careful hand washing of a black vehicle" fill sizes="(max-width: 760px) 100vw, 55vw" style={{ objectFit: "cover" }} /></div>
          <figcaption className={styles.processCaption}><span className={styles.processLabel}>CARE STARTS WITH A CLEAN SURFACE</span></figcaption>
        </figure>
        <div className={styles.craftCopy}><h3>More than a wash.{" "}<br />A refinement of the paint.</h3><p>A wash removes dirt. Paint correction addresses suitable imperfections in the clear coat through carefully selected machine polishing. Light reflects more clearly, revealing depth that washing alone can’t restore.</p></div>
        <div className={styles.concerns}>{benefits.map((benefit, index) => <article key={benefit.title}><small>0{index + 1}</small><div><h4>{benefit.title}</h4><p>{benefit.text}</p></div></article>)}</div>
      </div>
      <div className={styles.suitability}><p className={styles.eyebrow}>IS IT RIGHT FOR YOUR CAR?</p><p>A daily driver with wash marks. A used car ready for a refresh. Paint you want to refine before ceramic coating.</p><p>Deep damage may need repair. Matte finishes, wraps and paint protection film need a different care approach—tell us about them before booking.</p></div>
    </section>

    <section className={styles.service} id="your-correction" aria-labelledby="service-title">
      <div className={styles.serviceIntro}>
        <p className={styles.eyebrow}>02 / OPTIONS & PRICING</p>
        <h2 id="service-title">Your paint.<br /><span>The right correction.</span></h2>
        <p>Choose the level that best matches what you see. We inspect the paint before work and confirm the safe, realistic scope.</p>
        <div className={styles.approaches}>
          {correctionPackages.map((item) => (
            <article key={item.id}>
              <span>{item.name.toUpperCase()}</span>
              <h3>{item.priceCents === null ? "Custom assessment" : money(item.priceCents)}</h3>
              <p>{item.description}</p>
              <Link href={`${booking}&package=${item.id}`}>Choose this level</Link>
            </article>
          ))}
        </div>
        <p className={styles.approachNote}>Correction percentages are targets, not promises. Paint thickness, previous repairs and defect depth determine the safe result.</p>
      </div>
      <aside className={styles.bookingCard} aria-label="Paint correction service details"><span className={styles.cardTag}>PAINT CORRECTION</span><div className={styles.price}>{servicePrice(service)}</div><p className={styles.duration}>Estimated appointment <strong>{serviceDuration(service.duration_minutes)}</strong></p><ul>{service.includes.map(item => <li key={item}>{bookingInclusionLabels.get(item.trim().toLowerCase()) ?? item}</li>)}</ul><Link href={booking} className="button">Book your correction</Link><p className={styles.cardNote}>{service.pricing_mode === "quote" ? "Your vehicle and paint condition guide your final quote." : "Sedan pricing shown. Vehicle size and paint condition guide your final quote."} Scope agreed before work begins.</p></aside>
    </section>

    <section className={styles.journey} id="your-visit" aria-labelledby="journey-title">
      <div className={styles.journeyIntro}><p className={styles.eyebrow}>03 / THE PROCESS</p><h2 id="journey-title">Care in every step.<br /><span>Clarity at every stage.</span></h2><p>From the first inspection to the final reflection, here’s what your car’s visit involves.</p></div>
      <div className={styles.stages}>{stages.map((stage, index) => <details key={stage.title} open={index === 0}><summary><span className={styles.stageNumber}>0{index + 1}</span><span><strong>{stage.title}</strong><small>{stage.subtitle}</small></span><i aria-hidden="true">+</i></summary><p>{stage.text}</p></details>)}</div>
      <aside className={styles.aftercare}><span className={styles.aftercareMark} aria-hidden="true">+</span><h3>Keep the clarity.</h3><p>Careful washing helps preserve the finish. Use clean, suitable wash materials and avoid introducing new marks. For easier ongoing maintenance, ask about ceramic coating after correction.</p><Link href="/services/ceramic-coating">Explore ceramic protection</Link><small>A separate service. Ceramic coating does not make paint scratch-proof.</small></aside>
    </section>

    <section className={styles.finish} id="paint-questions" aria-labelledby="finish-title">
      <div className={styles.faqs}><p className={styles.eyebrow}>04 / GOOD TO KNOW</p>{questions.map(item => <details key={item.title}><summary>{item.title}<span aria-hidden="true">+</span></summary><p>{item.answer}</p></details>)}</div>
      <div className={styles.finalAction}><p className={styles.eyebrow}>LET’S GET YOUR FINISH BACK.</p><h2 id="finish-title">See your paint<br /><span>differently.</span></h2><p>Choose a time and tell us about your car.<br />We’ll help you find the right correction.</p><div><Link className="button" href={booking}>Book paint correction</Link><Link className="button outline" href="/contact">Ask about your vehicle</Link></div></div>
    </section>
  </div>;
}
