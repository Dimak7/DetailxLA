import type { HeroVideoSource } from "./hero-media";

export type HeroPlaybackState = "playing" | "paused" | "blocked" | "ended";
export type HeroPlayback = {
  setVisible: (visible: boolean) => void;
  play: () => void;
  pause: () => void;
  seek: (progress: number) => void;
  dispose: () => void;
};
export type HeroPlaybackEvents = {
  onProgress: (progress: number) => void;
  onState: (state: HeroPlaybackState) => void;
  onFailure: () => void;
};

/** Play once while visible, hold the polished finish, and replay only on request. */
export function createHeroVideo(
  host: HTMLElement,
  source: HeroVideoSource,
  signal: AbortSignal,
  events: HeroPlaybackEvents,
): Promise<HeroPlayback> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.defaultMuted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = "auto";
    video.controls = false;
    video.disablePictureInPicture = true;
    video.setAttribute("autoplay", "");
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("aria-hidden", "true");
    video.setAttribute("tabindex", "-1");
    video.setAttribute("disableRemotePlayback", "");
    video.poster = source.poster;

    let ready = false;
    let disposed = false;
    let visible = false;
    let manuallyPaused = false;
    let blocked = false;
    let finished = false;
    let playRequest = 0;
    let pendingPlayRequest: number | null = null;
    let automaticAttempts = 0;
    let stallTimeout: ReturnType<typeof setTimeout> | undefined;
    let replayTimeout: ReturnType<typeof setTimeout> | undefined;

    const wantsPlayback = () => ready && visible && !manuallyPaused && !blocked && !finished && !disposed;

    function interruptPlayback() {
      playRequest++;
      pendingPlayRequest = null;
      video.autoplay = false;
      video.pause();
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      interruptPlayback();
      clearTimeout(stallTimeout);
      clearTimeout(replayTimeout);
      delete host.dataset.replaying;
      signal.removeEventListener("abort", abort);
      video.removeEventListener("loadedmetadata", loaded);
      video.removeEventListener("loadeddata", playable);
      video.removeEventListener("canplay", playable);
      video.removeEventListener("timeupdate", progress);
      video.removeEventListener("play", playbackStarting);
      video.removeEventListener("playing", playing);
      video.removeEventListener("ended", ended);
      video.removeEventListener("waiting", waiting);
      video.removeEventListener("stalled", waiting);
      video.removeEventListener("error", failed);
      video.removeAttribute("src");
      video.load();
      video.remove();
    }

    function abort() {
      if (!ready) reject(new DOMException("Hero video cancelled", "AbortError"));
      dispose();
    }

    function failed() {
      if (disposed) return;
      const wasReady = ready;
      dispose();
      if (wasReady) events.onFailure();
      else reject(new Error("The hero film could not be decoded"));
    }

    function progress() {
      if (disposed || !ready) return;
      clearTimeout(stallTimeout);
      events.onProgress(Math.max(0, Math.min(1, video.currentTime / video.duration)));
    }

    function playing() {
      if (!wantsPlayback()) { video.autoplay = false; video.pause(); return; }
      automaticAttempts = 0;
      clearTimeout(stallTimeout);
      events.onState("playing");
    }

    function playbackStarting() {
      // Native autoplay can race the caller's first visibility update on iOS.
      if (!wantsPlayback()) { video.autoplay = false; video.pause(); }
    }

    function waiting() {
      if (!wantsPlayback()) return;
      clearTimeout(stallTimeout);
      stallTimeout = setTimeout(failed, 15000);
    }

    function ended() {
      // A queued end event can arrive after a chapter selection moved backward.
      if (disposed || video.currentTime < video.duration) return;
      finished = true;
      interruptPlayback();
      clearTimeout(stallTimeout);
      events.onProgress(1);
      events.onState("ended");
    }

    function requestPlay() {
      if (!wantsPlayback() || pendingPlayRequest !== null || !video.paused || automaticAttempts >= 3) return;
      const request = ++playRequest;
      pendingPlayRequest = request;
      automaticAttempts++;
      video.autoplay = true;

      function rejected(error: unknown) {
        if (pendingPlayRequest === request) pendingPlayRequest = null;
        if (disposed || request !== playRequest || !wantsPlayback()) return;
        clearTimeout(stallTimeout);
        const name = error && typeof error === "object" && "name" in error ? error.name : undefined;
        // Interrupted loads are retried only by a later readiness/visibility
        // event. Never turn a browser pause into an autoplay-policy failure.
        if (name === "AbortError") return;
        if (name !== "NotAllowedError") { failed(); return; }
        blocked = true;
        interruptPlayback();
        events.onState("blocked");
      }
      // Keep play() in the click's call stack when recovering blocked autoplay.
      try {
        void video.play().then(() => {
          if (pendingPlayRequest === request) pendingPlayRequest = null;
          if (!wantsPlayback()) video.pause();
        }).catch(rejected);
      } catch (error) { rejected(error); }
    }

    function playable() {
      loaded();
      requestPlay();
    }

    function loaded() {
      if (ready || disposed) return;
      if (!Number.isFinite(video.duration) || video.duration <= 0) { failed(); return; }
      ready = true;
      resolve({
        setVisible(nextVisible) {
          if (disposed || visible === nextVisible) return;
          visible = nextVisible;
          if (visible) { automaticAttempts = 0; requestPlay(); }
          else {
            interruptPlayback();
            clearTimeout(stallTimeout);
            if (!finished && !blocked) events.onState("paused");
          }
        },
        play() {
          if (disposed) return;
          manuallyPaused = false;
          blocked = false;
          automaticAttempts = 0;
          if (finished) {
            finished = false;
            // The matching clean still sits behind the film during this fade.
            host.dataset.replaying = "true";
            clearTimeout(replayTimeout);
            replayTimeout = setTimeout(() => { delete host.dataset.replaying; }, 750);
            try { video.currentTime = 0; }
            catch { failed(); return; }
            events.onProgress(0);
          }
          requestPlay();
        },
        pause() {
          if (disposed) return;
          manuallyPaused = true;
          interruptPlayback();
          clearTimeout(stallTimeout);
          if (!finished) events.onState("paused");
        },
        seek(nextProgress) {
          if (disposed || !Number.isFinite(nextProgress)) return;
          const target = Math.max(0, Math.min(1, nextProgress));
          manuallyPaused = true;
          blocked = false;
          finished = target === 1;
          interruptPlayback();
          clearTimeout(stallTimeout);
          clearTimeout(replayTimeout);
          delete host.dataset.replaying;
          try { video.currentTime = target * video.duration; }
          catch { failed(); return; }
          events.onProgress(target);
          events.onState(finished ? "ended" : "paused");
        },
        dispose,
      });
    }

    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    video.addEventListener("loadedmetadata", loaded);
    video.addEventListener("loadeddata", playable);
    video.addEventListener("canplay", playable);
    video.addEventListener("timeupdate", progress);
    video.addEventListener("play", playbackStarting);
    video.addEventListener("playing", playing);
    video.addEventListener("ended", ended);
    video.addEventListener("waiting", waiting);
    video.addEventListener("stalled", waiting);
    video.addEventListener("error", failed);
    host.appendChild(video);
    video.src = source.src;
    video.load();
  });
}
