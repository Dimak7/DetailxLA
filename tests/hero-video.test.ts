import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createHeroVideo, type HeroPlaybackState } from "../components/westloop/hero-video";

const source = { src: "/test-film.mp4", poster: "/first.webp", cleanPoster: "/last.webp" };

// A controllable media element lets the tests reproduce delayed play promises,
// browser autoplay policy, and events arriving after a visitor leaves the hero.
class VideoDecoder extends EventTarget {
  duration = 8;
  readyState = 0;
  autoplay = false;
  muted = false;
  defaultMuted = false;
  playsInline = false;
  attributes = new Map<string, string>();
  configurationAtSource: { autoplay: boolean; muted: boolean; defaultMuted: boolean; inline: boolean; attributes: string[] } | undefined;
  private playhead = 0;
  private mediaSource = "";
  rejectNextSeek = false;
  removed = false;
  paused = true;
  playCalls = 0;
  rejectNextPlay = false;
  playError: Error | null = null;
  deferNextPlay = false;
  private pendingPlays: { resolve: () => void; reject: (error: Error) => void }[] = [];

  constructor(private autoLoad: boolean, private loadEvent: "loadedmetadata" | "loadeddata") { super(); }
  get src() { return this.mediaSource; }
  set src(value: string) {
    if (value) this.configurationAtSource = {
      autoplay: this.autoplay, muted: this.muted, defaultMuted: this.defaultMuted,
      inline: this.playsInline, attributes: [...this.attributes.keys()],
    };
    this.mediaSource = value;
  }
  get currentTime() { return this.playhead; }
  set currentTime(value: number) {
    if (this.rejectNextSeek) {
      this.rejectNextSeek = false;
      throw new DOMException("Seek failed", "InvalidStateError");
    }
    this.playhead = value;
  }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); if (name === "src") this.src = ""; }
  pause() { this.paused = true; }
  remove() { this.removed = true; }
  load() {
    if (this.autoLoad && this.src) queueMicrotask(() => {
      if (this.src && !this.removed) {
        this.readyState = this.loadEvent === "loadedmetadata" ? 1 : 2;
        this.dispatchEvent(new Event(this.loadEvent));
      }
    });
  }
  play() {
    this.playCalls++;
    if (this.rejectNextPlay) {
      this.rejectNextPlay = false;
      return Promise.reject(new DOMException("Autoplay blocked", "NotAllowedError"));
    }
    if (this.playError) {
      const error = this.playError;
      this.playError = null;
      return Promise.reject(error);
    }
    if (this.deferNextPlay) {
      this.deferNextPlay = false;
      return new Promise<void>((resolve, reject) => {
        this.pendingPlays.push({ resolve: () => { this.beginPlayback(); resolve(); }, reject });
      });
    }
    this.beginPlayback();
    return Promise.resolve();
  }
  private beginPlayback() {
    this.paused = false;
    this.dispatchEvent(new Event("play"));
    if (!this.paused) this.dispatchEvent(new Event("playing"));
  }
  nativePlay() { this.beginPlayback(); }
  resolvePlay() { this.pendingPlays.shift()?.resolve(); }
  rejectPlay(error: Error) { this.pendingPlays.shift()?.reject(error); }
  advance(seconds: number) { this.currentTime = seconds; this.dispatchEvent(new Event("timeupdate")); }
  finish() { this.currentTime = this.duration; this.paused = true; this.dispatchEvent(new Event("ended")); }
}

function setup(t: TestContext, { autoLoad = true, loadEvent = "loadeddata" as "loadedmetadata" | "loadeddata" } = {}) {
  let video: VideoDecoder;
  let failures = 0;
  const controller = new AbortController();
  const states: HeroPlaybackState[] = [];
  const progress: number[] = [];
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => (video = new VideoDecoder(autoLoad, loadEvent)) },
  });
  t.after(() => {
    controller.abort();
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  });
  const host = { appendChild() {}, dataset: {} } as unknown as HTMLElement;
  return {
    controller, states, progress, host,
    get video() { return video; },
    get failures() { return failures; },
    create: () => createHeroVideo(host, source, controller.signal, {
      onState: (state) => states.push(state),
      onProgress: (value) => progress.push(value),
      onFailure: () => { failures++; },
    }),
  };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("the film plays only while visible and resumes at the same playhead", async (t) => {
  const h = setup(t);
  const player = await h.create();
  assert.equal(h.video.playCalls, 0);
  player.setVisible(true);
  assert.equal(h.video.paused, false);
  assert.equal(h.states.at(-1), "playing");
  h.video.advance(3.2);
  player.setVisible(false);
  assert.equal(h.video.paused, true);
  player.setVisible(true);
  assert.equal(h.video.currentTime, 3.2, "visibility does not restart the sequence");
  assert.equal(h.video.playCalls, 2);
  assert.equal(h.progress.at(-1), 0.4);
});

test("a visitor's pause is preserved across visibility changes", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  player.pause();
  player.setVisible(false);
  player.setVisible(true);
  assert.equal(h.video.paused, true);
  assert.equal(h.video.playCalls, 1, "returning to the hero cannot override manual pause");
  player.play();
  assert.equal(h.video.paused, false);
  assert.equal(h.video.playCalls, 2);
});

test("the polished finish is held until an explicit replay", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  h.video.finish();
  assert.equal(h.states.at(-1), "ended");
  assert.equal(h.progress.at(-1), 1);
  player.setVisible(false);
  player.setVisible(true);
  assert.equal(h.video.playCalls, 1, "the clean car must not jump back to dirty on return");
  assert.equal(h.video.currentTime, h.video.duration);
  player.play();
  assert.equal(h.video.currentTime, 0);
  assert.equal(h.video.paused, false);
  assert.equal(h.progress.at(-1), 0);
  assert.equal(h.host.dataset.replaying, "true", "replay fades from the matching clean still");
});

test("blocked autoplay waits for an explicit play request instead of retrying offscreen", async (t) => {
  const h = setup(t);
  const player = await h.create();
  h.video.rejectNextPlay = true;
  player.setVisible(true);
  await settle();
  assert.equal(h.states.at(-1), "blocked");
  assert.equal(h.failures, 0, "autoplay policy is not a broken media file");
  player.setVisible(false);
  player.setVisible(true);
  assert.equal(h.video.playCalls, 1);
  player.play();
  await settle();
  assert.equal(h.video.paused, false);
  assert.equal(h.states.at(-1), "playing");
});

test("a late play promise cannot override a visitor's pause", async (t) => {
  const h = setup(t);
  const player = await h.create();
  h.video.deferNextPlay = true;
  player.setVisible(true);
  player.pause();
  h.video.resolvePlay();
  await settle();
  assert.equal(h.video.paused, true);
  assert.equal(h.states.at(-1), "paused");
  assert.equal(h.states.includes("playing"), false);
});

test("cancellation during pending playback releases media and ignores late events", async (t) => {
  const h = setup(t);
  const player = await h.create();
  h.video.deferNextPlay = true;
  player.setVisible(true);
  h.controller.abort();
  h.video.resolvePlay();
  h.video.advance(6);
  h.video.dispatchEvent(new Event("error"));
  await settle();
  assert.equal(h.video.paused, true);
  assert.equal(h.video.src, "");
  assert.equal(h.video.removed, true);
  assert.deepEqual(h.states, []);
  assert.deepEqual(h.progress, []);
  assert.equal(h.failures, 0);
});

test("decoder failure releases the film and invokes the still fallback once", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  h.video.dispatchEvent(new Event("error"));
  assert.equal(h.failures, 1);
  assert.equal(h.video.src, "");
  assert.equal(h.video.removed, true);
  h.video.dispatchEvent(new Event("error"));
  h.video.advance(4);
  player.play();
  assert.equal(h.failures, 1);
  assert.deepEqual(h.progress, []);
  assert.equal(h.video.playCalls, 1);
});

test("cancelling an unfinished load rejects without treating navigation as failure", async (t) => {
  const h = setup(t, { autoLoad: false });
  const loading = h.create();
  const rejected = assert.rejects(loading, { name: "AbortError" });
  h.controller.abort();
  await rejected;
  assert.equal(h.video.src, "");
  assert.equal(h.video.removed, true);
  assert.equal(h.failures, 0);
});

test("an already cancelled load never requests the film", async (t) => {
  const h = setup(t);
  h.controller.abort();
  await assert.rejects(h.create(), { name: "AbortError" });
  assert.equal(h.video.src, "");
  assert.equal(h.video.playCalls, 0);
});

test("selecting a stage pauses at its time and stays paused across visibility changes", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  h.video.advance(1);
  player.seek(0.5);
  assert.equal(h.video.currentTime, 4);
  assert.equal(h.video.paused, true);
  assert.equal(h.progress.at(-1), 0.5);
  assert.equal(h.states.at(-1), "paused");
  player.setVisible(false);
  player.setVisible(true);
  assert.equal(h.video.paused, true);
  assert.equal(h.video.playCalls, 1, "stage selection must not resume when scrolling back");
  player.play();
  assert.equal(h.video.currentTime, 4, "Play resumes the selected stage instead of restarting");
  assert.equal(h.video.paused, false);
});

test("selecting an earlier stage from the finish clears replay state and resumes normally", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  h.video.finish();
  player.seek(0.25);
  assert.equal(h.video.currentTime, 2);
  assert.equal(h.states.at(-1), "paused");
  player.play();
  assert.equal(h.video.currentTime, 2);
  assert.equal(h.host.dataset.replaying, undefined, "leaving the finish via a stage is not a replay");

  h.video.finish();
  player.play();
  assert.equal(h.host.dataset.replaying, "true");
  player.seek(0.75);
  assert.equal(h.host.dataset.replaying, undefined, "stage selection cancels an in-progress replay fade");
  assert.equal(h.video.currentTime, 6);
  assert.equal(h.video.paused, true);
});

test("a late play promise cannot restart a selected stage", async (t) => {
  const h = setup(t);
  const player = await h.create();
  h.video.deferNextPlay = true;
  player.setVisible(true);
  player.seek(0.5);
  h.video.resolvePlay();
  await settle();
  assert.equal(h.video.currentTime, 4);
  assert.equal(h.video.paused, true);
  assert.equal(h.states.at(-1), "paused");
  assert.equal(h.states.includes("playing"), false);
});

test("stage bounds clamp to the beginning or held finish with the appropriate controls", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  player.seek(1.4);
  assert.equal(h.video.currentTime, 8);
  assert.equal(h.progress.at(-1), 1);
  assert.equal(h.states.at(-1), "ended");
  player.setVisible(false);
  player.setVisible(true);
  assert.equal(h.video.paused, true);
  player.play();
  assert.equal(h.video.currentTime, 0, "Play at the final endpoint becomes Replay");

  player.seek(-0.4);
  assert.equal(h.video.currentTime, 0);
  assert.equal(h.progress.at(-1), 0);
  assert.equal(h.states.at(-1), "paused");
  player.seek(0.99);
  assert.equal(h.states.at(-1), "paused", "only the exact clamped endpoint is finished");
  player.play();
  assert.equal(h.video.currentTime, 7.92, "near-end stages still resume rather than replay");
});

test("invalid or cancelled stage requests leave playback and events unchanged", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  h.video.advance(2);
  const statesBefore = [...h.states];
  const progressBefore = [...h.progress];
  for (const invalid of [NaN, Infinity, -Infinity]) player.seek(invalid);
  assert.equal(h.video.currentTime, 2);
  assert.equal(h.video.paused, false, "an invalid selection must not interrupt playback");
  assert.deepEqual(h.states, statesBefore);
  assert.deepEqual(h.progress, progressBefore);
  h.controller.abort();
  player.seek(0.75);
  assert.equal(h.video.currentTime, 2);
  assert.deepEqual(h.states, statesBefore);
  assert.deepEqual(h.progress, progressBefore);
});

test("stage selection recovers the Play control after blocked autoplay", async (t) => {
  const h = setup(t);
  const player = await h.create();
  h.video.rejectNextPlay = true;
  player.setVisible(true);
  await settle();
  player.seek(0.5);
  assert.equal(h.states.at(-1), "paused");
  assert.equal(h.video.currentTime, 4);
  player.setVisible(false);
  player.setVisible(true);
  assert.equal(h.video.playCalls, 1);
  player.play();
  await settle();
  assert.equal(h.video.paused, false);
  assert.equal(h.video.currentTime, 4);
  assert.equal(h.states.at(-1), "playing");
});

test("a failed stage seek releases the film and invokes fallback once", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  h.video.rejectNextSeek = true;
  player.seek(0.5);
  assert.equal(h.failures, 1);
  assert.equal(h.video.paused, true);
  assert.equal(h.video.removed, true);
  assert.equal(h.video.src, "");
  assert.deepEqual(h.progress, [], "do not report a stage that could not be shown");
  player.seek(0.25);
  h.video.dispatchEvent(new Event("error"));
  assert.equal(h.failures, 1);
});

test("a queued end event cannot replace a newly selected earlier stage", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  h.video.finish();
  player.seek(0.32);
  h.video.dispatchEvent(new Event("ended"));
  assert.equal(h.progress.at(-1), 0.32);
  assert.equal(h.states.at(-1), "paused");
  player.play();
  assert.equal(h.video.currentTime, 2.56, "the stale event must not turn Play into Replay");
});

test("Safari inline autoplay is configured before source assignment and starts from metadata alone", async (t) => {
  const h = setup(t, { loadEvent: "loadedmetadata" });
  const player = await h.create();
  const initial = h.video.configurationAtSource;
  assert.ok(initial?.autoplay && initial.muted && initial.defaultMuted && initial.inline);
  for (const name of ["autoplay", "muted", "playsinline", "webkit-playsinline"]) {
    assert.ok(initial.attributes.includes(name), `${name} must exist before src is assigned`);
  }
  assert.equal(h.video.readyState, 1, "the controller must not wait for loadeddata on iOS");
  player.setVisible(true);
  assert.equal(h.video.playCalls, 1);
  assert.equal(h.states.at(-1), "playing");
});

test("repeated metadata and readiness events do not duplicate a pending or active play", async (t) => {
  const h = setup(t, { loadEvent: "loadedmetadata" });
  const player = await h.create();
  h.video.deferNextPlay = true;
  player.setVisible(true);
  for (const event of ["loadedmetadata", "loadeddata", "canplay", "canplay"]) h.video.dispatchEvent(new Event(event));
  assert.equal(h.video.playCalls, 1);
  h.video.resolvePlay();
  await settle();
  for (const event of ["loadeddata", "canplay"]) h.video.dispatchEvent(new Event(event));
  assert.equal(h.video.playCalls, 1, "readiness should not call play again while already playing");
});

test("an interrupted play retries only on readiness, with a bounded number of attempts", async (t) => {
  const h = setup(t, { loadEvent: "loadedmetadata" });
  const player = await h.create();
  h.video.playError = new DOMException("Loading was interrupted", "AbortError");
  player.setVisible(true);
  await settle();
  assert.equal(h.video.playCalls, 1, "AbortError must not immediately loop play calls");
  assert.equal(h.states.includes("blocked"), false);
  assert.equal(h.failures, 0);
  for (let retry = 0; retry < 2; retry++) {
    h.video.playError = new DOMException("Loading was interrupted", "AbortError");
    h.video.dispatchEvent(new Event("canplay"));
    await settle();
  }
  h.video.dispatchEvent(new Event("canplay"));
  assert.equal(h.video.playCalls, 3, "readiness retries must be bounded");
  assert.equal(h.failures, 0, "an interrupted browser load is not a decode failure");
  player.play();
  assert.equal(h.video.playCalls, 4, "an explicit visitor request still gets a fresh attempt");
  assert.equal(h.states.at(-1), "playing");
});

test("policy rejection stays blocked through later readiness and native autoplay events", async (t) => {
  const h = setup(t, { loadEvent: "loadedmetadata" });
  const player = await h.create();
  h.video.rejectNextPlay = true;
  player.setVisible(true);
  await settle();
  for (const event of ["loadeddata", "canplay", "canplay"]) h.video.dispatchEvent(new Event(event));
  h.video.nativePlay();
  assert.equal(h.video.paused, true);
  assert.equal(h.video.autoplay, false);
  assert.equal(h.video.playCalls, 1);
  assert.equal(h.states.at(-1), "blocked");
  assert.equal(h.failures, 0);
});

test("native autoplay and readiness cannot override hidden, paused, selected, or finished states", async (t) => {
  const h = setup(t, { loadEvent: "loadedmetadata" });
  const player = await h.create();
  h.video.nativePlay();
  assert.equal(h.video.paused, true, "native autoplay must wait for the caller's visibility update");
  assert.deepEqual(h.states, []);
  player.setVisible(true);
  assert.equal(h.video.paused, false);
  for (const stop of [() => player.pause(), () => player.seek(0.5), () => player.seek(1), () => player.setVisible(false)]) {
    stop();
    const calls = h.video.playCalls;
    const previousStates: HeroPlaybackState[] = [...h.states];
    for (const event of ["loadeddata", "canplay"]) h.video.dispatchEvent(new Event(event));
    h.video.nativePlay();
    assert.equal(h.video.paused, true);
    assert.equal(h.video.playCalls, calls);
    assert.deepEqual(h.states, previousStates);
  }
});

test("an old play resolution cannot release a newer request's in-flight guard", async (t) => {
  const h = setup(t, { loadEvent: "loadedmetadata" });
  const player = await h.create();
  h.video.deferNextPlay = true;
  player.setVisible(true);
  player.setVisible(false);
  h.video.deferNextPlay = true;
  player.setVisible(true);
  assert.equal(h.video.playCalls, 2);
  h.video.resolvePlay();
  await settle();
  h.video.pause(); // Browser pauses independently while the newer request is pending.
  h.video.dispatchEvent(new Event("canplay"));
  assert.equal(h.video.playCalls, 2, "the old promise must not unlock a third play attempt");
  h.video.resolvePlay();
  await settle();
  assert.equal(h.video.paused, false);
});

test("an old play rejection cannot block or release a newer request", async (t) => {
  const h = setup(t, { loadEvent: "loadedmetadata" });
  const player = await h.create();
  h.video.deferNextPlay = true;
  player.setVisible(true);
  player.pause();
  h.video.deferNextPlay = true;
  player.play();
  h.video.rejectPlay(new DOMException("An old request was rejected", "NotAllowedError"));
  await settle();
  h.video.dispatchEvent(new Event("canplay"));
  assert.equal(h.video.playCalls, 2);
  assert.equal(h.states.includes("blocked"), false);
  h.video.resolvePlay();
  await settle();
  assert.equal(h.states.at(-1), "playing");
});

test("non-policy playback errors use media failure rather than blocked-autoplay state", async (t) => {
  const h = setup(t, { loadEvent: "loadedmetadata" });
  const player = await h.create();
  h.video.playError = new DOMException("Unsupported media", "NotSupportedError");
  player.setVisible(true);
  await settle();
  assert.equal(h.failures, 1);
  assert.equal(h.states.includes("blocked"), false);
  assert.equal(h.video.removed, true);
  h.video.dispatchEvent(new Event("canplay"));
  assert.equal(h.video.playCalls, 1);
});

test("invalid metadata is rejected without starting playback", async (t) => {
  const h = setup(t, { autoLoad: false });
  const loading = h.create();
  h.video.duration = Infinity;
  const rejected = assert.rejects(loading, /could not be decoded/);
  h.video.dispatchEvent(new Event("loadedmetadata"));
  await rejected;
  assert.equal(h.video.playCalls, 0);
  assert.equal(h.video.removed, true);
});
