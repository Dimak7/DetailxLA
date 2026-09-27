"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { HeroScene } from "./hero-scene";
import styles from "./CinematicHero.module.css";

const chapters = [
  { label: "The everyday", title: "Your car deserves better.", detail: "Road grime. City dust. A finish waiting to come back." },
  { label: "The reset", title: "Care in every contour.", detail: "A thoughtful clean, down to the smallest detail." },
  { label: "The refinement", title: "A deeper kind of clean.", detail: "Clear glass. Clean wheels. Paint that catches the light." },
  { label: "The finish", title: "We bring the showroom back.", detail: "Premium detailing for people who care about their car." },
];

export function CinematicHero() {
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const meter = useRef<HTMLDivElement>(null);
  const percentage = useRef<HTMLSpanElement>(null);
  const [chapter, setChapter] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "static" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const root = section.current!, screen = viewport.current!, host = stage.current!;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const device = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
    const abort = new AbortController();
    let scene: HeroScene | undefined;
    let raf = 0, visible = true, starting = false, current = 0, lastFrame = 0, lastChapter = -1;
    let pointer = { x: 0, y: 0 }, smoothed = { x: 0, y: 0 };
    let timeout: ReturnType<typeof setTimeout> | undefined;

    function staticView(failed = false) {
      root.dataset.interactive = "false";
      setStatus(failed ? "error" : "static");
      setChapter(3);
      cancelAnimationFrame(raf); raf = 0;
      scene?.dispose(); scene = undefined;
    }
    function frame(now: number) {
      raf = 0;
      if (!visible || document.hidden || !scene || abort.signal.aborted) return;
      const travel = root.offsetHeight - screen.offsetHeight;
      const target = Math.max(0, Math.min(1, -root.getBoundingClientRect().top / Math.max(1, travel)));
      const blend = 1 - Math.exp(-Math.min(64, now - (lastFrame || now - 16)) / 75);
      lastFrame = now;
      current += (target - current) * blend;
      smoothed.x += (pointer.x - smoothed.x) * blend;
      smoothed.y += (pointer.y - smoothed.y) * blend;
      scene.update(current, smoothed.x, smoothed.y);
      root.style.setProperty("--finish", current.toFixed(4));
      if (meter.current) meter.current.style.transform = `scaleX(${current})`;
      if (percentage.current) percentage.current.textContent = `${Math.round(current * 100)}`.padStart(2, "0") + "%";
      const next = current < 0.2 ? 0 : current < 0.5 ? 1 : current < 0.78 ? 2 : 3;
      if (next !== lastChapter) { setChapter(next); lastChapter = next; }
      if (Math.abs(target - current) > 0.0001 || Math.abs(pointer.x - smoothed.x) > 0.001 || Math.abs(pointer.y - smoothed.y) > 0.001) wake();
    }
    function wake() { if (!raf && visible && !document.hidden && scene) raf = requestAnimationFrame(frame); }
    function resize() { scene?.resize(); wake(); }
    function move(event: PointerEvent) {
      if (event.pointerType !== "mouse") return;
      const bounds = screen.getBoundingClientRect();
      pointer = { x: ((event.clientX - bounds.left) / bounds.width - 0.5) * 2, y: ((event.clientY - bounds.top) / bounds.height - 0.5) * 2 };
      wake();
    }
    function leave() { pointer = { x: 0, y: 0 }; wake(); }
    function contextLost(event: Event) { event.preventDefault(); abort.abort(); staticView(true); }
    function motionChanged() { if (motion.matches) { abort.abort(); staticView(); } }
    async function start() {
      if (starting || abort.signal.aborted) return;
      starting = true;
      setStatus("loading");
      timeout = setTimeout(() => { abort.abort(); staticView(true); }, 25000);
      try {
        const { createHeroScene } = await import("./hero-scene");
        if (abort.signal.aborted) return;
        const result = await createHeroScene(host, abort.signal);
        if (abort.signal.aborted) { result.dispose(); return; }
        scene = result;
        root.dataset.interactive = "true";
        host.querySelector("canvas")?.addEventListener("webglcontextlost", contextLost);
        setStatus("ready");
        wake();
      } catch {
        if (!abort.signal.aborted) staticView(true);
      } finally { clearTimeout(timeout); }
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) { void start(); wake(); }
      else { cancelAnimationFrame(raf); raf = 0; }
    }, { rootMargin: "100px" });
    const resizeObserver = new ResizeObserver(resize);
    if (motion.matches || (!attempt && (device.connection?.saveData || (device.deviceMemory && device.deviceMemory <= 2)))) staticView();
    else { observer.observe(root); resizeObserver.observe(host); }
    window.addEventListener("scroll", wake, { passive: true });
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", wake);
    screen.addEventListener("pointermove", move, { passive: true });
    screen.addEventListener("pointerleave", leave);
    motion.addEventListener("change", motionChanged);
    return () => {
      clearTimeout(timeout); abort.abort(); cancelAnimationFrame(raf);
      observer.disconnect(); resizeObserver.disconnect();
      window.removeEventListener("scroll", wake); window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", wake);
      screen.removeEventListener("pointermove", move); screen.removeEventListener("pointerleave", leave);
      motion.removeEventListener("change", motionChanged);
      scene?.dispose();
    };
  }, [attempt]);

  function jump(progress: number) {
    const root = section.current!, screen = viewport.current!;
    window.scrollTo({ top: window.scrollY + root.getBoundingClientRect().top + progress * (root.offsetHeight - screen.offsetHeight), behavior: "smooth" });
  }

  return (
    <section ref={section} className={styles.hero} aria-label="The West Loop detailing transformation" data-status={status}>
      <div ref={viewport} className={styles.viewport}>
        <div className={styles.topline}><span>WEST LOOP AUTO SPA / CHICAGO</span><a href="#services">Skip to services <span aria-hidden="true">&#8595;</span></a></div>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>AUTOMOTIVE CARE, TRANSFORMED</p>
          <h1 key={chapter}>{chapters[chapter].title}</h1>
          <p className={styles.description}>{chapters[chapter].detail}</p>
        </div>
        <div className={styles.visual}>
          <div className={styles.halo} aria-hidden="true" />
          <picture>
            <source media="(max-width: 760px)" srcSet={status === "static" || status === "error" ? "/hero/poster-clean-mobile.webp" : "/hero/poster-mobile.webp"} type="image/webp" />
            <Image src={status === "static" || status === "error" ? "/hero/poster-clean.webp" : "/hero/poster.webp"} alt={status === "static" || status === "error" ? "Deep green sports car after detailing in a softly lit studio" : "Road-worn sports car before the West Loop detailing treatment"} fill priority sizes="(max-width: 760px) 100vw, 85vw" className={styles.poster} aria-hidden={status === "ready"} />
          </picture>
          <div ref={stage} className={styles.canvas} role="img" aria-hidden={status !== "ready"} aria-label="A single sports car rotates from road-worn paint to a polished finish as you scroll" />
          <span className={styles.studioLabel}>THE WEST LOOP TREATMENT</span>
          <a className={styles.credit} href="/hero/credits.txt" target="_blank" rel="noreferrer">3D model credit</a>
        </div>
        <div className={styles.bottom}>
          <div className={styles.actions}>
            <Link href="/booking" className={styles.book}>Book your detail <span aria-hidden="true">&#8599;</span></Link>
            <Link href="/gallery" className={styles.work}>View our work <span aria-hidden="true">&#8599;</span></Link>
          </div>
          <div className={styles.journey}>
            <div className={styles.journeyHeading}>
              <span>{status === "ready" ? "SCROLL TO TRANSFORM" : status === "loading" ? "PREPARING YOUR STUDIO VIEW" : "A FINISH WORTH COMING BACK FOR"}</span>
              <span ref={percentage} aria-hidden="true">{status === "static" || status === "error" ? "100%" : "00%"}</span>
            </div>
            <div className={styles.track}><div ref={meter} /></div>
            <div className={styles.chapters} aria-label="Transformation stages">
              {chapters.map((item, index) => <button key={item.label} onClick={() => jump(index / 3)} disabled={status !== "ready"} aria-current={chapter === index ? "step" : undefined}><span>0{index + 1}</span>{item.label}</button>)}
            </div>
          </div>
          {status === "error" && <p className={styles.fallbackNote}>Showing the studio still. <button onClick={() => setAttempt((a) => a + 1)}>Retry interactive view</button></p>}
        </div>
      </div>
      <noscript><style>{`.${styles.hero}{height:auto!important}.${styles.journey}{display:none}@media(max-width:760px){.${styles.bottom}{bottom:90px}}`}</style></noscript>
    </section>
  );
}
