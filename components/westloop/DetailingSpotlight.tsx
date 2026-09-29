import Link from "next/link";
import type { Service } from "@/lib/platform/types";
import { servicePrice } from "@/lib/service-content";
import styles from "./DetailingSpotlight.module.css";

/** Published services supply every price, route and booking identifier. */
export function DetailingSpotlight({ services }: { services: Service[] }) {
  const correction = services.find((service) => service.slug === "paint-correction");
  const fullDetail = services.find((service) => service.slug === "full-detail");
  if (!correction && !fullDetail) return null;

  return (
    <section className={styles.spotlight} aria-label="Paint correction and full service detailing">
      <div className={styles.inner}>
        {correction && <article className={styles.correction}>
          <p className={styles.eyebrow}>PAINT CORRECTION</p>
          <h2>Clean paint.<br /><em>Clearer reflections.</em></h2>
          <p className={styles.intro}>Still seeing swirls after a wash? Paint correction refines suitable surface marks through assessed machine polishing. Explore what one step or a more involved correction can do for your finish.</p>
          <ul className={styles.concerns} aria-label="Reasons to consider paint correction"><li>Wash swirls</li><li>Fine surface marks</li><li>Haze &amp; dullness</li></ul>
          <div className={styles.price}><strong>{servicePrice(correction)}</strong><span>Paint condition and the agreed scope guide the result.</span></div>
          <div className={styles.links}>
            <Link className={styles.primary} href={`/services/${correction.slug}`}>Explore paint correction</Link>
            <Link className={styles.textLink} href={`/booking?service=${encodeURIComponent(correction.id)}`}>Book paint correction</Link>
          </div>
        </article>}
        {fullDetail && <article className={styles.fullDetail}>
          <p className={styles.eyebrow}>FULL SERVICE DETAILING</p>
          <h2>A fresh start.<br /><em>Inside and out.</em></h2>
          <p>For a cleaner cabin and a refreshed exterior in one appointment. See how interior care, the hand wash and finishing steps come together.</p>
          <div className={styles.fullScope}><span>INTERIOR CARE</span><span aria-hidden="true">+</span><span>EXTERIOR DETAIL</span></div>
          <p className={styles.scopeNote}>Paint correction and ceramic coating are separate services unless included in your agreed scope.</p>
          <div className={styles.fullFooter}><strong>{servicePrice(fullDetail)}</strong><Link className={styles.textLink} href={`/services/${fullDetail.slug}`}>See full detail inclusions</Link></div>
        </article>}
      </div>
    </section>
  );
}
