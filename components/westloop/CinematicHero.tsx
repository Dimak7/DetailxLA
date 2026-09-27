"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { heroVideoMedia } from "./hero-media";
import type { HeroPlayback, HeroPlaybackState } from "./hero-video";
import styles from "./CinematicHero.module.css";

export function CinematicHero() {
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const player = useRef<HeroPlayback | null>(null);
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
    let timeout: ReturnType<typeof setTimeout> | undefined;

    function staticView(failed = false) {
      clearTimeout(timeout);
      player.current?.dispose();
      player.current = null;
      setStatus(failed ? "error" : "static");
    }
    function syncVisibility() {
      player.current?.setVisible(visible && !document.hidden);
    }
    function motionChanged() {
      if (motion.matches) {
        abort.abort();
        staticView();
      }
    }
    async function start() {
      if (starting || abort.signal.aborted || !heroVideoMedia) return;
      starting = true;
      setStatus("loading");
      timeout = setTimeout(() => {
        abort.abort();
        staticView(true);
      }, 25000);
      try {
        const { createHeroVideo } = await import("./hero-video");
        if (abort.signal.aborted) return;
        const source = window.matchMedia("(max-width: 760px)").matches
          ? heroVideoMedia.mobile ?? heroVideoMedia.desktop
          : heroVideoMedia.desktop;
        const result = await createHeroVideo(host, source, abort.signal, {
          onProgress: () => {},
          onState: setPlayback,
          onFailure: () => staticView(true),
        });
        if (abort.signal.aborted) {
          result.dispose();
          return;
        }
        player.current = result;
        setStatus("ready");
        syncVisibility();
      } catch {
        if (!abort.signal.aborted) staticView(true);
      } finally {
        clearTimeout(timeout);
      }
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting && entry.intersectionRatio >= 0.15;
        if (visible && !document.hidden) void start();
        syncVisibility();
      },
      { threshold: 0.15 },
    );
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

  const controlLabel =
    playback === "playing"
      ? "Pause film"
      : playback === "ended"
        ? "Replay film"
        : "Play film";

  return (
    <section
      ref={section}
      className={styles.hero}
      aria-label="West Loop Ceramics — a finish worth protecting"
      data-status={status}
      data-playback={playback}
    >
      <div className={styles.heading}>
        <p className={styles.eyebrow}>CHICAGO CERAMIC COATING & DETAILING</p>
        <h1>
          A finish worth <em>protecting.</em>
        </h1>
        <p className={styles.description}>
          Paint correction, ceramic protection, and premium detailing
          <br className={styles.mobileBreak} /> for drivers who care about the finish.
        </p>
        <div className={styles.actions}>
          <Link href="/booking" className={styles.primary}>Book an appointment</Link>
          <Link href="/services" className={styles.secondary}>View services & pricing</Link>
        </div>
      </div>

      <div className={styles.visual}>
        <div className={styles.mediaFrame}>
          <picture>
            <source media="(max-width: 760px)" srcSet={mobilePoster} />
            <Image
              src={desktopPoster}
              alt="A polished Porsche 911, prepared to perfection in a softly lit studio"
              fill
              priority
              unoptimized
              sizes="(max-width: 760px) 100vw, 1250px"
              className={styles.poster}
              aria-hidden={status === "ready"}
            />
          </picture>
          <div
            ref={stage}
            className={styles.canvas}
            role="img"
            aria-hidden={status !== "ready"}
            aria-label={heroVideoMedia?.description ?? "A Porsche 911 turns through a careful wash to reveal a polished finish"}
          />
        </div>
        <div className={styles.filmControls}>
          {status === "ready" && (
            <button
              type="button"
              className={styles.playback}
              onClick={() => playback === "playing" ? player.current?.pause() : player.current?.play()}
              aria-label={controlLabel}
            >
              {playback === "playing" ? (
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3v10M11 3v10" /></svg>
              ) : playback === "ended" ? (
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6a5.5 5.5 0 1 1-.4 5M3 2v4h4" /></svg>
              ) : (
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 3 8 5-8 5Z" /></svg>
              )}
              {controlLabel}
            </button>
          )}
          {status === "error" && (
            <button type="button" className={styles.playback} onClick={() => setAttempt((value) => value + 1)}>
              Play film
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
