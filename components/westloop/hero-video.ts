import type { HeroVideoSource } from "./hero-media";
import type { HeroScene } from "./hero-scene";

/** A paused, scroll-seeked film using the same lifecycle as the 3D scene. */
export function createHeroVideo(
  host: HTMLElement,
  source: HeroVideoSource,
  signal: AbortSignal,
  onFailure: () => void,
): Promise<HeroScene> {
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
    let progress = 0;
    let frame = 0;
    let seekTimeout: ReturnType<typeof setTimeout> | undefined;

    function dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      clearTimeout(seekTimeout);
      signal.removeEventListener("abort", abort);
      video.removeEventListener("loadeddata", loaded);
      video.removeEventListener("canplay", requestSeek);
      video.removeEventListener("seeked", seeked);
      video.removeEventListener("error", failed);
      video.removeEventListener("play", pause);
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
      if (!ready) {
        reject(new Error("The hero video could not be decoded"));
        dispose();
      } else {
        dispose();
        onFailure();
      }
    }

    function pause() { video.pause(); }

    function flushSeek() {
      frame = 0;
      if (disposed || !ready || video.readyState < 2 || video.seeking) return;
      // Stop on the last decodable frame instead of the empty end-of-stream frame.
      const target = progress * Math.max(0, video.duration - 1 / 30);
      if (Math.abs(video.currentTime - target) < 1 / 60) return;
      try {
        video.currentTime = target;
        clearTimeout(seekTimeout);
        seekTimeout = setTimeout(failed, 12000);
      } catch {
        failed();
      }
    }

    function requestSeek() {
      if (!disposed && !frame) frame = requestAnimationFrame(flushSeek);
    }

    function seeked() {
      clearTimeout(seekTimeout);
      // A busy decoder keeps only the newest target, including reverse scrolling.
      requestSeek();
    }

    function loaded() {
      if (ready || disposed) return;
      if (!Number.isFinite(video.duration) || video.duration <= 0) { failed(); return; }
      ready = true;
      resolve({
        update(nextProgress) {
          progress = Math.max(0, Math.min(1, nextProgress));
          requestSeek();
        },
        resize: requestSeek,
        dispose,
      });
    }

    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    video.addEventListener("loadeddata", loaded);
    video.addEventListener("canplay", requestSeek);
    video.addEventListener("seeked", seeked);
    video.addEventListener("error", failed);
    // No autoplay or playback loop: scroll position is the only playhead.
    video.addEventListener("play", pause);
    host.appendChild(video);
    video.src = source.src;
    video.load();
  });
}
