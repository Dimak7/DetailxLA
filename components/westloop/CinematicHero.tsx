import Image from "next/image";
import Link from "next/link";
import styles from "./CinematicHero.module.css";

export function CinematicHero() {
  return <section className={styles.hero} aria-label="West Loop Ceramics — premium detailing and ceramic coating in Chicago">
    <Image src="/brand/photos/mercedes-foam.webp" alt="Black Mercedes covered in wash foam in a detailing bay" fill priority sizes="100vw" className={styles.poster} />
    <div className={styles.heading}>
      <p className={styles.eyebrow}>WEST LOOP · CHICAGO</p>
      <h1>Premium detailing.<br /><em>Ceramic coating.</em></h1>
      <p className={styles.description}>Paint correction and complete interior and exterior care in Chicago’s West Loop.</p>
      <div className={styles.actions}>
        <Link href="/services" className="button light">See services &amp; prices</Link>
        <Link href="/booking" className="button outline on-dark">Detail from $250</Link>
      </div>
    </div>
  </section>;
}
