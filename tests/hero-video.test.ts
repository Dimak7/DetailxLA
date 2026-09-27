import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createHeroVideo, type HeroPlaybackState } from "../components/westloop/hero-video";

const source = { src: "/test-film.mp4", poster: "/first.webp", cleanPoster: "/last.webp" };

// A controllable media element lets the tests reproduce delayed play promises,
// browser autoplay policy, and events arriving after a visitor leaves the hero.
class VideoDecoder extends EventTarget {
  duration = 8;
  private playhead = 0;
  rejectNextSeek = false;
  src = "";
  removed = false;
  paused = true;
  playCalls = 0;
  rejectNextPlay = false;
  deferNextPlay = false;
  private pendingPlay: (() => void) | undefined;

  constructor(private autoLoad: boolean) { super(); }
  get currentTime() { return this.playhead; }
  set currentTime(value: number) {
    if (this.rejectNextSeek) {
      this.rejectNextSeek = false;
      throw new DOMException("Seek failed", "InvalidStateError");
    }
    this.playhead = value;
  }
  setAttribute() {}
  removeAttribute(name: string) { if (name === "src") this.src = ""; }
  pause() { this.paused = true; }
  remove() { this.removed = true; }
  load() {
    if (this.autoLoad && this.src) queueMicrotask(() => {
      if (this.src && !this.removed) this.dispatchEvent(new Event("loadeddata"));
    });
  }
  play() {
    this.playCalls++;
    if (this.rejectNextPlay) {
      this.rejectNextPlay = false;
      return Promise.reject(new DOMException("Autoplay blocked", "NotAllowedError"));
    }
    if (this.deferNextPlay) {
      this.deferNextPlay = false;
      return new Promise<void>((resolve) => {
        this.pendingPlay = () => { this.beginPlayback(); resolve(); };
      });
    }
    this.beginPlayback();
    return Promise.resolve();
  }
  private beginPlayback() {
    this.paused = false;
    this.dispatchEvent(new Event("playing"));
  }
  resolvePlay() { this.pendingPlay?.(); this.pendingPlay = undefined; }
  advance(seconds: number) { this.currentTime = seconds; this.dispatchEvent(new Event("timeupdate")); }
  finish() { this.currentTime = this.duration; this.paused = true; this.dispatchEvent(new Event("ended")); }
}

function setup(t: TestContext, { autoLoad = true } = {}) {
  let video: VideoDecoder;
  let failures = 0;
  const controller = new AbortController();
  const states: HeroPlaybackState[] = [];
  const progress: number[] = [];
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => (video = new VideoDecoder(autoLoad)) },
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
