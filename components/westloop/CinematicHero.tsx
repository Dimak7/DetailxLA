"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { heroVideoMedia } from "./hero-media";
import type { HeroPlayback, HeroPlaybackState } from "./hero-video";
import styles from "./CinematicHero.module.css";

const chapters = ["Road-worn", "The wash", "The rinse", "The reveal"];

export function CinematicHero() {
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const meter = useRef<HTMLDivElement>(null);
  const progressBar = useRef<HTMLDivElement>(null);
  const player = useRef<HeroPlayback | null>(null);
  const [chapter, setChapter] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "static" | "error">("loading");
  const [playback, setPlayback] = useState<HeroPlaybackState>("paused");
  const [attempt, setAttempt] = useState(0);
  const desktopPoster = heroVideoMedia?.desktop.cleanPoster ?? "/hero/poster-clean.webp";
  const mobilePoster = heroVideoMedia?.mobile?.cleanPoster ?? desktopPoster;

  useEffect(() => {
    const root = section.current!;
    const host = stage.current!;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const abort = new AbortController();
    let visible = false;
    let starting = false;
    let previousChapter = -1;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    function progress(value: number) {
      if (meter.current) meter.current.style.transform = `scaleX(${value})`;
      progressBar.current?.setAttribute("aria-valuenow", String(Math.round(value * 100)));
      const nextChapter = value < 0.2 ? 0 : value < 0.5 ? 1 : value < 0.78 ? 2 : 3;
      if (nextChapter !== previousChapter) { previousChapter = nextChapter; setChapter(nextChapter); }
    }
    function staticView(failed = false) {
      clearTimeout(timeout);
      player.current?.dispose();
      player.current = null;
      setStatus(failed ? "error" : "static");
      progress(1);
    }
    function syncVisibility() { player.current?.setVisible(visible && !document.hidden); }
    function motionChanged() {
      if (motion.matches) { abort.abort(); staticView(); }
    }
    async function start() {
      if (starting || abort.signal.aborted || !heroVideoMedia) return;
      starting = true;
      setStatus("loading");
      timeout = setTimeout(() => { abort.abort(); staticView(true); }, 25000);
      try {
        const { createHeroVideo } = await import("./hero-video");
        if (abort.signal.aborted) return;
        const source = window.matchMedia("(max-width: 760px)").matches
          ? heroVideoMedia.mobile ?? heroVideoMedia.desktop
          : heroVideoMedia.desktop;
        const result = await createHeroVideo(host, source, abort.signal, {
          onProgress: progress,
          onState: setPlayback,
          onFailure: () => staticView(true),
        });
        if (abort.signal.aborted) { result.dispose(); return; }
        player.current = result;
        progress(0);
        setStatus("ready");
        syncVisibility();
      } catch {
        if (!abort.signal.aborted) staticView(true);
      } finally { clearTimeout(timeout); }
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && entry.intersectionRatio >= 0.15;
      if (visible && !document.hidden) void start();
      syncVisibility();
    }, { threshold: 0.15 });
    function visibilityChanged() {
      if (visible && !document.hidden) void start();
      syncVisibility();
    }
    if (!heroVideoMedia || motion.matches || connection?.saveData) staticView();
    else observer.observe(root);
    document.addEventListener("visibilitychange", visibilityChanged);
    motion.addEventListener("change", motionChanged);
    return () => {
      clearTimeout(timeout);
      abort.abort();
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibilityChanged);
      motion.removeEventListener("change", motionChanged);
      player.current?.dispose();
      player.current = null;
    };
  }, [attempt]);

  const controlLabel = playback === "playing" ? "Pause film" : playback === "ended" ? "Replay film" : "Play film";

  return (
    <section ref={section} className={styles.hero} aria-label="West Loop Ceramics — a finish worth protecting" data-status={status} data-playback={playback}>
      <div className={styles.heading}>
        <p className={styles.eyebrow}><span aria-hidden="true" /> WEST LOOP CERAMICS <span className={styles.location}>CHICAGO, IL</span></p>
        <h1>A finish worth <em>protecting.</em></h1>
        <p className={styles.description}>Precision detailing. Lasting ceramic protection.<br className={styles.mobileBreak} /> An extraordinary finish, every time.</p>
        <div className={styles.actions}>
          <Link href="/services/ceramic-coating" className={styles.primary}>Explore ceramic coatings <span aria-hidden="true">↗</span></Link>
          <Link href="/booking" className={styles.secondary}>Book your detail <span aria-hidden="true">↗</span></Link>
        </div>
      </div>

      <div className={styles.visual}>
        <div className={styles.studioGlow} aria-hidden="true" />
        <picture>
          <source media="(max-width: 760px)" srcSet={mobilePoster} />
          <Image src={desktopPoster} alt="A polished Porsche 911, prepared to perfection in a softly lit studio" fill priority sizes="(max-width: 760px) 100vw, 1180px" className={styles.poster} aria-hidden={status === "ready"} />
        </picture>
        <div ref={stage} className={styles.canvas} role="img" aria-hidden={status !== "ready"} aria-label={heroVideoMedia?.description ?? "A Porsche 911 turns through a careful wash to reveal a polished finish"} />
      </div>

      <div className={styles.bottom}>
        <div className={styles.signature}><span className={styles.monogram} aria-hidden="true">W/C</span><p>THE ART OF CAR CARE<span>Details make the difference.</span></p></div>
        <div className={styles.journey}>
          <div ref={progressBar} className={styles.track} role="progressbar" aria-label="Detailing film progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}><div ref={meter} /></div>
          <ol className={styles.chapters} aria-label="The detailing transformation">
            {chapters.map((label, index) => <li key={label} aria-current={chapter === index ? "step" : undefined}><span>0{index + 1}</span>{label}</li>)}
          </ol>
        </div>
        <div className={styles.filmControls}>
          {status === "ready" && <button type="button" className={styles.playback} onClick={() => playback === "playing" ? player.current?.pause() : player.current?.play()} aria-label={controlLabel}>
            {playback === "playing" ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3v10M11 3v10" /></svg> : playback === "ended" ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6a5.5 5.5 0 1 1-.4 5M3 2v4h4" /></svg> : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 3 8 5-8 5Z" /></svg>}
            {controlLabel}
          </button>}
          {status === "loading" && <span className={styles.filmNote}>Preparing the film</span>}
          {status === "static" && <span className={styles.filmNote}>The final finish</span>}
          {status === "error" && <button type="button" className={styles.playback} onClick={() => setAttempt((value) => value + 1)}>Retry film <span aria-hidden="true">↻</span></button>}
          <a className={styles.credit} href="/hero/credits.txt" target="_blank" rel="noreferrer">Visual credits</a>
        </div>
      </div>
      <noscript><style>{`.${styles.journey},.${styles.filmNote}{display:none}`}</style></noscript>
    </section>
  );
}
