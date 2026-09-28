import type { HeroPlayback, HeroPlaybackEvents } from "./hero-video";

type HeroAnimationSource = { src: string; durationMs: number };
type HeroAnimation = Pick<HeroPlayback, "setVisible" | "play" | "pause" | "dispose">;

/** A one-pass image has no seek/pause API: stopping returns to the clean still. */
export async function createHeroAnimation(
  host: HTMLElement,
  source: HeroAnimationSource,
  signal: AbortSignal,
  events: HeroPlaybackEvents,
): Promise<HeroAnimation> {
  if (!Number.isFinite(source.durationMs) || source.durationMs <= 0) {
    throw new RangeError("The hero animation needs a positive duration");
  }

  const request = new AbortController();
  let blob: Blob | null = null;
  let image: HTMLImageElement | null = null;
  let objectUrl: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let visible = false;
  let started = false;
  let finished = false;

  function clearImage() {
    clearTimeout(timer);
    timer = undefined;
    if (image) {
      image.onload = null;
      image.onerror = null;
      image.removeAttribute("src");
      image.remove();
      image = null;
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener("abort", dispose);
    request.abort();
    clearImage();
    blob = null;
  }

  function finish() {
    if (disposed || finished) return;
    started = true;
    finished = true;
    clearImage();
    events.onProgress(1);
    if (!disposed) events.onState("ended");
  }

  function failed() {
    if (disposed) return;
    dispose();
    events.onFailure();
  }

  function play() {
    if (disposed || !visible || image || !blob) return;
    started = true;
    finished = false;
    try {
      // A new URL restarts image decoding, without downloading the film again.
      objectUrl = URL.createObjectURL(blob);
      const nextImage = document.createElement("img");
      image = nextImage;
      nextImage.alt = "";
      nextImage.setAttribute("aria-hidden", "true");
      nextImage.style.visibility = "hidden";
      let loaded = false;
      nextImage.onload = () => {
        if (disposed || image !== nextImage || !visible || loaded) return;
        loaded = true;
        clearTimeout(timer);
        nextImage.style.visibility = "visible";
        timer = setTimeout(finish, source.durationMs);
        events.onProgress(0);
        if (!disposed && image === nextImage) events.onState("playing");
      };
      nextImage.onerror = () => {
        if (!disposed && image === nextImage) failed();
      };
      host.appendChild(nextImage);
      timer = setTimeout(() => {
        if (!disposed && image === nextImage && !loaded) failed();
      }, 10000);
      nextImage.src = objectUrl;
    } catch {
      failed();
    }
  }

  if (signal.aborted) throw new DOMException("Hero animation cancelled", "AbortError");
  signal.addEventListener("abort", dispose, { once: true });
  try {
    const response = await fetch(source.src, { signal: request.signal, mode: "same-origin" });
    if (!response.ok) throw new Error(`The hero animation could not be loaded (${response.status})`);
    blob = await response.blob();
    if (disposed) {
      blob = null;
      throw new DOMException("Hero animation cancelled", "AbortError");
    }
  } catch (error) {
    dispose();
    throw error;
  }

  return {
    setVisible(nextVisible) {
      if (disposed || visible === nextVisible) return;
      visible = nextVisible;
      if (visible && !started) play();
      else if (!visible && image) finish();
    },
    play,
    pause: finish,
    dispose,
  };
}
