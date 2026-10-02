"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import styles from "./PaintFilm.module.css";

type PaintFilmProps = {
  kind: "hero" | "process";
  paused: boolean;
  allowReducedMotion?: boolean;
  onPlaybackChange?: (playing: boolean) => void;
};

export function PaintFilm({ kind, paused, allowReducedMotion = false, onPlaybackChange }: PaintFilmProps) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const pausedByPage = useRef(paused);
  const motionAllowedByPage = useRef(allowReducedMotion);
  const playbackCallback = useRef(onPlaybackChange);
  const syncPlayback = useRef<() => void>(() => {});
  const retryPlayback = useRef<() => void>(() => {});
  const [firstFrame, setFirstFrame] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const poster = kind === "hero" ? "/paint-correction/hero-after-matched.webp" : "/paint-correction/process-poster.webp";
  const film = kind === "hero" ? "hero-after" : "process";
  const showStaticPoster = reducedMotion && !allowReducedMotion;

  useEffect(() => {
    playbackCallback.current = onPlaybackChange;
  }, [onPlaybackChange]);

  useEffect(() => {
    if (!player.current || !host.current) return;
    const video = player.current;
    const element = host.current;

    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const bounds = element.getBoundingClientRect();
    let visible = bounds.bottom > 0 && bounds.top < window.innerHeight;
    let disposed = false;
    let pendingPlay = false;
    let reportedPlaying = false;
    let frameReceived = false;
    let frameCallback: number | undefined;
    let interactionRetryUsed = false;

    setFirstFrame(false);
    setBlocked(false);
    setReducedMotion(motionPreference.matches);
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;

    function canPlay() {
      return !disposed && !video.error && !pausedByPage.current && (!motionPreference.matches || motionAllowedByPage.current) && visible && !document.hidden;
    }

    function reportPlayback(playing: boolean) {
      if (reportedPlaying === playing) return;
      reportedPlaying = playing;
      playbackCallback.current?.(playing);
    }

    function revealFrame() {
      if (frameReceived || frameCallback !== undefined || !canPlay()) return;
      const reveal = () => {
        frameCallback = undefined;
        if (!canPlay() || video.paused || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return;
        frameReceived = true;
        setFirstFrame(true);
      };
      if (typeof video.requestVideoFrameCallback === "function") {
        frameCallback = video.requestVideoFrameCallback(reveal);
      } else if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        reveal();
      }
    }

    function restorePoster() {
      if (frameCallback !== undefined) {
        video.cancelVideoFrameCallback(frameCallback);
        frameCallback = undefined;
      }
      frameReceived = false;
      setFirstFrame(false);
    }

    function removeInteractionRetry() {
      document.removeEventListener("pointerdown", retryAfterInteraction);
      document.removeEventListener("keydown", retryAfterInteraction);
    }

    function retryAfterInteraction() {
      if (!canPlay()) return;
      interactionRetryUsed = true;
      removeInteractionRetry();
      attemptPlay();
    }

    function attemptPlay() {
      if (!canPlay() || pendingPlay) return;
      if (!video.paused) {
        revealFrame();
        return;
      }
      video.muted = true;
      pendingPlay = true;
      const playResult = video.play();
      if (!playResult) {
        pendingPlay = false;
        return;
      }
      void playResult.then(() => {
        if (disposed) return;
        if (!canPlay()) {
          video.pause();
          return;
        }
        setBlocked(false);
        removeInteractionRetry();
        revealFrame();
      }).catch((error: unknown) => {
        if (disposed || !canPlay()) return;
        const name = error instanceof Error ? error.name : "";
        if (name !== "NotAllowedError") return;
        setBlocked(true);
        if (!interactionRetryUsed) {
          document.addEventListener("pointerdown", retryAfterInteraction, { passive: true });
          document.addEventListener("keydown", retryAfterInteraction);
        }
      }).finally(() => {
        pendingPlay = false;
      });
    }

    function sync() {
      if (canPlay()) attemptPlay();
      else {
        video.pause();
        restorePoster();
        reportPlayback(false);
      }
    }

    function onPlaying() {
      if (!canPlay()) {
        video.pause();
        return;
      }
      setBlocked(false);
      removeInteractionRetry();
      revealFrame();
      reportPlayback(true);
    }

    function onPause() {
      restorePoster();
      reportPlayback(false);
    }
    function onBuffering() {
      restorePoster();
      reportPlayback(false);
    }
    function onMediaError() {
      restorePoster();
      setBlocked(false);
      reportPlayback(false);
    }
    function onTimeUpdate() {
      if (!video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) revealFrame();
    }
    function onMotionChange() {
      setReducedMotion(motionPreference.matches);
      sync();
    }

    syncPlayback.current = sync;
    retryPlayback.current = attemptPlay;
    video.addEventListener("loadeddata", sync);
    video.addEventListener("canplay", sync);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onBuffering);
    video.addEventListener("stalled", onBuffering);
    video.addEventListener("emptied", onMediaError);
    video.addEventListener("error", onMediaError);
    video.addEventListener("abort", onMediaError);
    video.addEventListener("timeupdate", onTimeUpdate);
    document.addEventListener("visibilitychange", sync);
    motionPreference.addEventListener("change", onMotionChange);

    const observer = typeof IntersectionObserver === "function"
      ? new IntersectionObserver(([entry]) => {
          visible = entry.isIntersecting;
          sync();
        }, { threshold: 0 })
      : null;
    function checkVisibility() {
      const position = element.getBoundingClientRect();
      visible = position.bottom > 0 && position.top < window.innerHeight;
      sync();
    }
    if (observer) observer.observe(element);
    else {
      window.addEventListener("scroll", checkVisibility, { passive: true });
      window.addEventListener("resize", checkVisibility, { passive: true });
    }
    sync();

    return () => {
      disposed = true;
      syncPlayback.current = () => {};
      retryPlayback.current = () => {};
      observer?.disconnect();
      window.removeEventListener("scroll", checkVisibility);
      window.removeEventListener("resize", checkVisibility);
      removeInteractionRetry();
      document.removeEventListener("visibilitychange", sync);
      motionPreference.removeEventListener("change", onMotionChange);
      video.removeEventListener("loadeddata", sync);
      video.removeEventListener("canplay", sync);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onBuffering);
      video.removeEventListener("stalled", onBuffering);
      video.removeEventListener("emptied", onMediaError);
      video.removeEventListener("error", onMediaError);
      video.removeEventListener("abort", onMediaError);
      video.removeEventListener("timeupdate", onTimeUpdate);
      if (frameCallback !== undefined) video.cancelVideoFrameCallback(frameCallback);
      video.pause();
    };
  }, [kind]);

  useEffect(() => {
    pausedByPage.current = paused;
    motionAllowedByPage.current = allowReducedMotion;
    syncPlayback.current();
  }, [paused, allowReducedMotion]);

  return (
    <div ref={host} className={`${styles.film} ${kind === "hero" ? styles.hero : styles.process} ${allowReducedMotion ? styles.motionAllowed : ""}`}>
      <video
        key={kind}
        ref={player}
        className={`${styles.video} ${firstFrame && !showStaticPoster && !paused ? styles.ready : ""}`}
        autoPlay={kind === "hero" && !paused && !showStaticPoster}
        muted
        playsInline
        loop
        preload={kind === "hero" ? "auto" : "metadata"}
        poster={poster}
        disablePictureInPicture
        aria-hidden="true"
        tabIndex={-1}
      >
        <source src={`/paint-correction/${film}-film-mobile.mp4`} type="video/mp4" media="(max-width: 700px)" />
        <source src={`/paint-correction/${film}-film.mp4`} type="video/mp4" />
      </video>
      <Image
        className={styles.poster}
        src={poster}
        alt=""
        fill
        unoptimized
        sizes="100vw"
        priority={kind === "hero"}
      />
      {blocked && !paused && !showStaticPoster && (
        <button className={styles.play} type="button" onClick={() => retryPlayback.current()} aria-label={`Play ${kind === "hero" ? "Porsche" : "paint correction"} film`}>
          <span aria-hidden="true" className={styles.playIcon} />
          Play film
        </button>
      )}
    </div>
  );
}
