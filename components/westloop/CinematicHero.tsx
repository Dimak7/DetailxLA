"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "./CinematicHero.module.css";
export function CinematicHero() {
  const video = useRef<HTMLVideoElement>(null),
    [playing, setPlaying] = useState(false),
    [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      const allowed =
        !motion.matches &&
        !(navigator as Navigator & { connection?: { saveData?: boolean } })
          .connection?.saveData;
      setEnabled(allowed);
      if (!allowed) video.current?.pause();
    };
    update();
    motion.addEventListener("change", update);
    return () => motion.removeEventListener("change", update);
  }, []);
  return (
    <section
      className={styles.hero}
      aria-label="Car detailing and ceramic coating in Chicago"
    >
      <div className={styles.visual} aria-hidden="true">
        <video
          ref={video}
          autoPlay={enabled}
          muted
          loop
          playsInline
          preload="none"
          poster="/paint-correction/process-poster.webp"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        >
          {enabled && (
            <>
              <source
                src="/paint-correction/process-film-mobile.mp4"
                media="(max-width: 760px)"
                type="video/mp4"
              />
              <source
                src="/paint-correction/process-film.mp4"
                type="video/mp4"
              />
            </>
          )}
        </video>
      </div>
      <div className={styles.heading}>
        <p className={styles.eyebrow}>
          CHICAGO’S WEST LOOP · AUTO DETAILING STUDIO
        </p>
        <h1>
          A finish that turns heads
          <br />
          <em>Care that goes deeper.</em>
        </h1>
        <p className={styles.description}>
          Expert detailing, paint correction and ceramic protection.
          <br /> Bring back the feeling of a car you love to drive.
        </p>
        <div className={styles.actions}>
          <Link href="/booking" className="button gold">
            Book your detail <span aria-hidden="true">↗</span>
          </Link>
          <Link href="/contact" className="button outline on-dark">
            Get a coating quote <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <Link className={styles.services} href="/services">
          Explore services &amp; prices <span aria-hidden="true">→</span>
        </Link>
      </div>
      <div className={styles.bottom}>
        <div>
          <span>01 / REFRESH</span>
          <strong>Interior &amp; exterior detailing</strong>
        </div>
        <div>
          <span>02 / REFINE</span>
          <strong>Paint correction</strong>
        </div>
        <div>
          <span>03 / PROTECT</span>
          <strong>Ceramic coating</strong>
        </div>
      </div>
      {enabled && (
        <button
          className={styles.control}
          type="button"
          aria-label={
            playing ? "Pause background video" : "Play background video"
          }
          onClick={() => {
            if (playing) video.current?.pause();
            else void video.current?.play().catch(() => {});
          }}
        >
          {playing ? "Ⅱ Pause" : "▷ Play"}
        </button>
      )}
    </section>
  );
}
