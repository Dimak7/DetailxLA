"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { heroVideoMedia, mobileHeroMediaQuery } from "./hero-media";
import { createHeroAnimation } from "./hero-animation";
import type { HeroPlayback, HeroPlaybackState } from "./hero-video";
import styles from "./CinematicHero.module.css";

export function CinematicHero() {
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pausedByVisitor = useRef(false);
  const player = useRef<Pick<HeroPlayback, "setVisible" | "play" | "pause" | "dispose"> | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "static" | "error">("loading");
  const [playback, setPlayback] = useState<HeroPlaybackState>("paused");
  const [attempt, setAttempt] = useState(0);
  const [mediaMode, setMediaMode] = useState<"video" | "animation">("video");
  const [frameReady, setFrameReady] = useState(false);
  const desktopPoster = heroVideoMedia?.desktop.cleanPoster ?? "/hero/poster-clean.webp";
  const mobilePoster = heroVideoMedia?.mobile?.cleanPoster ?? desktopPoster;

  useEffect(() => {
    const root = section.current!;
    const host = stage.current!;
    const mobileAnimation = window.matchMedia(mobileHeroMediaQuery).matches;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const abort = new AbortController();
    const videoAbort = new AbortController();
    let visible = false;
    let starting = false;
    let fallbackStarted = false;
    let played = false;
    let startupTimeout: ReturnType<typeof setTimeout> | undefined;
    let fallbackTimeout: ReturnType<typeof setTimeout> | undefined;

    pausedByVisitor.current = false;
    setFrameReady(false);
    setPlayback("paused");
    setMediaMode("video");

    function staticView(failed = false) {
      clearTimeout(startupTimeout);
      clearTimeout(fallbackTimeout);
      abort.abort();
      videoAbort.abort();
      player.current?.dispose();
      player.current = null;
      setFrameReady(false);
      setStatus(failed ? "error" : "static");
    }
    function syncVisibility() {
      const active = visible && !document.hidden;
      player.current?.setVisible(active);
      // Some Safari versions leave play() pending instead of rejecting it.
      // Bound the initial wait, but never restart a film the visitor paused.
      if (!active || played || fallbackStarted || abort.signal.aborted) {
        clearTimeout(startupTimeout);
        startupTimeout = undefined;
      } else if (starting && !startupTimeout) {
        startupTimeout = setTimeout(() => void useAnimationFallback(), 10000);
      }
    }
    function motionChanged() {
      if (motion.matches) staticView();
    }
    async function useAnimationFallback() {
      if (abort.signal.aborted || fallbackStarted) return;
      if (pausedByVisitor.current) { staticView(); return; }
      fallbackStarted = true;
      clearTimeout(startupTimeout);
      videoAbort.abort();
      player.current?.dispose();
      player.current = null;
      setFrameReady(false);
      setMediaMode("animation");
      setStatus("loading");
      const source = mobileAnimation
        ? heroVideoMedia?.mobileAnimation ?? heroVideoMedia?.animation
        : heroVideoMedia?.animation;
      if (!source) { staticView(true); return; }
      fallbackTimeout = setTimeout(() => staticView(true), 25000);
      try {
        if (abort.signal.aborted) return;
        const result = await createHeroAnimation(host, source, abort.signal, {
          onProgress: () => {},
          onState: (state) => {
            if (abort.signal.aborted) return;
            clearTimeout(fallbackTimeout);
            setPlayback(state);
            setFrameReady(state === "playing");
            setStatus("ready");
          },
          onFailure: () => { if (!abort.signal.aborted) staticView(true); },
        });
        if (abort.signal.aborted) { result.dispose(); return; }
        clearTimeout(fallbackTimeout);
        player.current = result;
        syncVisibility();
      } catch {
        if (!abort.signal.aborted) staticView(true);
      }
    }
    async function start() {
      if (starting || abort.signal.aborted || !heroVideoMedia) return;
      starting = true;
      setStatus("loading");
      // Mobile starts with the image animation; it never waits for MP4 policy.
      if (mobileAnimation) { await useAnimationFallback(); return; }
      syncVisibility();
      try {
        const { createHeroVideo } = await import("./hero-video");
        if (videoAbort.signal.aborted) return;
        const source = window.matchMedia("(max-width: 760px)").matches
          ? heroVideoMedia.mobile ?? heroVideoMedia.desktop
          : heroVideoMedia.desktop;
        const result = await createHeroVideo(host, source, videoAbort.signal, {
          onProgress: () => {},
          onState: (state) => {
            if (videoAbort.signal.aborted) return;
            if (state === "blocked") { void useAnimationFallback(); return; }
            if (state === "playing" || state === "ended") {
              played = true;
              clearTimeout(startupTimeout);
              setFrameReady(true);
              setStatus("ready");
            }
            setPlayback(state);
          },
          onFailure: () => { if (!videoAbort.signal.aborted) void useAnimationFallback(); },
        });
        if (videoAbort.signal.aborted) { result.dispose(); return; }
        player.current = result;
        syncVisibility();
      } catch {
        if (!videoAbort.signal.aborted) void useAnimationFallback();
      }
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible && !document.hidden) void start();
        syncVisibility();
      },
      { threshold: 0 },
    );
    function visibilityChanged() {
      if (visible && !document.hidden) void start();
      syncVisibility();
    }
    if (!heroVideoMedia || motion.matches || connection?.saveData) staticView();
    else {
      const bounds = root.getBoundingClientRect();
      visible = bounds.bottom > 0 && bounds.top < window.innerHeight;
      if (visible && !document.hidden) void start();
      observer.observe(root);
    }
    document.addEventListener("visibilitychange", visibilityChanged);
    motion.addEventListener("change", motionChanged);
    return () => {
      clearTimeout(startupTimeout);
      clearTimeout(fallbackTimeout);
      abort.abort();
      videoAbort.abort();
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibilityChanged);
      motion.removeEventListener("change", motionChanged);
      player.current?.dispose();
      player.current = null;
    };
  }, [attempt]);

  const controlLabel =
    playback === "playing"
      ? mediaMode === "animation" ? "Stop animation" : "Pause film"
      : playback === "ended"
        ? "Replay film"
        : "Play film";

  return (
    <section
      ref={section}
      className={styles.hero}
      aria-label="West Loop Ceramics — premium car detailing in Chicago"
      data-status={status}
      data-playback={playback}
      data-media-mode={mediaMode}
      data-frame-ready={frameReady}
    >
      <div className={styles.heading}>
        <p className={styles.eyebrow}>CAR DETAILING IN CHICAGO’S WEST LOOP</p>
        <h1>
          Premium detailing.<br /><em>Inside &amp; out.</em>
        </h1>
        <p className={styles.description}>
          Interior and exterior detailing, paint correction and ceramic coating.
        </p>
        <div className={styles.actions}>
          <Link href="/services" className={styles.primary}>See services &amp; prices</Link>
          <Link href="/booking" className={styles.secondary}>Book a detail</Link>
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
              aria-hidden={frameReady}
            />
          </picture>
          <div
            ref={stage}
            className={styles.canvas}
            role="img"
            aria-hidden={!frameReady}
            aria-label={heroVideoMedia?.description ?? "A Porsche 911 turns through a careful wash to reveal a polished finish"}
          />
        </div>
        <div className={styles.filmControls}>
          {status === "ready" && (
            <button
              type="button"
              className={styles.playback}
              onClick={() => {
                pausedByVisitor.current = playback === "playing";
                if (pausedByVisitor.current) player.current?.pause();
                else player.current?.play();
              }}
              aria-label={controlLabel}
            >
              {playback === "playing" && mediaMode === "animation" ? (
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4h8v8H4Z" /></svg>
              ) : playback === "playing" ? (
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
              Retry film
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
