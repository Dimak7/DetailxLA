import type { HeroVideoSource } from "./hero-media";

export type HeroPlaybackState = "playing" | "paused" | "blocked" | "ended";
export type HeroPlayback = {
  setVisible: (visible: boolean) => void;
  play: () => void;
  pause: () => void;
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
    video.playsInline = true;
    video.preload = "auto";
    video.controls = false;
    video.disablePictureInPicture = true;
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
    let stallTimeout: ReturnType<typeof setTimeout> | undefined;
    let replayTimeout: ReturnType<typeof setTimeout> | undefined;

    const wantsPlayback = () => ready && visible && !manuallyPaused && !blocked && !finished && !disposed;

    function dispose() {
      if (disposed) return;
      disposed = true;
      playRequest++;
      clearTimeout(stallTimeout);
      clearTimeout(replayTimeout);
      delete host.dataset.replaying;
      signal.removeEventListener("abort", abort);
      video.removeEventListener("loadeddata", loaded);
      video.removeEventListener("timeupdate", progress);
      video.removeEventListener("playing", playing);
      video.removeEventListener("ended", ended);
      video.removeEventListener("waiting", waiting);
      video.removeEventListener("stalled", waiting);
      video.removeEventListener("error", failed);
      video.pause();
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
      if (!wantsPlayback()) { video.pause(); return; }
      clearTimeout(stallTimeout);
      events.onState("playing");
    }

    function waiting() {
      if (!wantsPlayback()) return;
      clearTimeout(stallTimeout);
      stallTimeout = setTimeout(failed, 15000);
    }

    function ended() {
      if (disposed) return;
      finished = true;
      playRequest++;
      clearTimeout(stallTimeout);
      events.onProgress(1);
      events.onState("ended");
    }

    function requestPlay() {
      if (!wantsPlayback()) return;
      const request = ++playRequest;
      // Keep play() in the click's call stack when recovering blocked autoplay.
      try {
        void video.play().then(() => {
          if (!wantsPlayback()) video.pause();
        }).catch(() => {
          if (disposed || request !== playRequest || !wantsPlayback()) return;
          blocked = true;
          clearTimeout(stallTimeout);
          video.pause();
          events.onState("blocked");
        });
      } catch {
        blocked = true;
        events.onState("blocked");
      }
    }

    function loaded() {
      if (ready || disposed) return;
      if (!Number.isFinite(video.duration) || video.duration <= 0) { failed(); return; }
      ready = true;
      resolve({
        setVisible(nextVisible) {
          if (disposed || visible === nextVisible) return;
          visible = nextVisible;
          if (visible) requestPlay();
          else {
            playRequest++;
            clearTimeout(stallTimeout);
            video.pause();
            if (!finished && !blocked) events.onState("paused");
          }
        },
        play() {
          if (disposed) return;
          manuallyPaused = false;
          blocked = false;
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
          playRequest++;
          clearTimeout(stallTimeout);
          video.pause();
          if (!finished) events.onState("paused");
        },
        dispose,
      });
    }

    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    video.addEventListener("loadeddata", loaded);
    video.addEventListener("timeupdate", progress);
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
