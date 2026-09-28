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
  if (signal.aborted) throw new DOMException("Hero animation cancelled", "AbortError");

  let blob: Blob | null = null;
  let image: HTMLImageElement | null = null;
  let objectUrl: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let replayTimer: ReturnType<typeof setTimeout> | undefined;
  let replayRequest: AbortController | null = null;
  let replayGeneration = 0;
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

  function cancelReplay() {
    replayGeneration++;
    clearTimeout(replayTimer);
    replayTimer = undefined;
    replayRequest?.abort();
    replayRequest = null;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener("abort", dispose);
    cancelReplay();
    clearImage();
    blob = null;
  }

  function finish() {
    if (disposed || finished) return;
    started = true;
    finished = true;
    cancelReplay();
    clearImage();
    events.onProgress(1);
    if (!disposed) events.onState("ended");
  }

  function failed() {
    if (disposed) return;
    dispose();
    events.onFailure();
  }

  function showImage(src: string) {
    try {
      const nextImage = document.createElement("img");
      image = nextImage;
      nextImage.alt = "";
      nextImage.setAttribute("aria-hidden", "true");
      nextImage.fetchPriority = "high";
      nextImage.loading = "eager";
      nextImage.style.visibility = "visible";
      let loaded = false;
      nextImage.onload = () => {
        if (disposed || image !== nextImage || !visible || loaded) return;
        loaded = true;
        clearTimeout(timer);
        // The image can animate while downloading; retaining it for a full
        // duration after load conservatively holds its final frame.
        timer = setTimeout(finish, source.durationMs);
      };
      nextImage.onerror = () => {
        if (!disposed && image === nextImage) failed();
      };
      host.appendChild(nextImage);
      timer = setTimeout(() => {
        if (!disposed && image === nextImage && !loaded) failed();
      }, 10000);
      nextImage.src = src;
      if (disposed || image !== nextImage) return;
      // Expose streamed frames immediately, without waiting for the entire
      // download. The component keeps its clean still beneath this image.
      events.onProgress(0);
      if (!disposed && image === nextImage) events.onState("playing");
    } catch {
      failed();
    }
  }

  function replayFromBlob() {
    if (!blob || disposed || !visible || finished) return;
    try {
      objectUrl = URL.createObjectURL(blob);
      showImage(objectUrl);
    } catch {
      failed();
    }
  }

  async function loadReplay() {
    const generation = ++replayGeneration;
    const request = new AbortController();
    replayRequest = request;
    const deadline = setTimeout(() => {
      if (!disposed && generation === replayGeneration && replayRequest === request) failed();
    }, 15000);
    replayTimer = deadline;
    try {
      // Only replay needs a fresh decoder URL. The initial image request has
      // already populated the browser cache, so no upfront blob fetch is used.
      const response = await fetch(source.src, { signal: request.signal, mode: "same-origin", cache: "force-cache" });
      if (!response.ok) throw new Error(`The hero animation could not be loaded (${response.status})`);
      const result = await response.blob();
      if (disposed || generation !== replayGeneration || request.signal.aborted || !visible || finished) return;
      blob = result;
      replayRequest = null;
      replayFromBlob();
    } catch {
      if (!disposed && generation === replayGeneration && !request.signal.aborted) failed();
    } finally {
      clearTimeout(deadline);
      if (generation === replayGeneration) replayTimer = undefined;
      if (replayRequest === request) replayRequest = null;
    }
  }

  function play() {
    if (disposed || !visible || image || replayRequest) return;
    const firstPlay = !started;
    started = true;
    finished = false;
    if (firstPlay) showImage(source.src);
    else if (blob) replayFromBlob();
    else void loadReplay();
  }

  signal.addEventListener("abort", dispose, { once: true });
  return {
    setVisible(nextVisible) {
      if (disposed || visible === nextVisible) return;
      visible = nextVisible;
      if (visible && !started) play();
      else if (!visible && (image || replayRequest)) finish();
    },
    play,
    pause: finish,
    dispose,
  };
}
