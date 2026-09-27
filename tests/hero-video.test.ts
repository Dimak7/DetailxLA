import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createHeroVideo } from "../components/westloop/hero-video";

const source = { src: "/test-film.mp4", poster: "/first.webp", cleanPoster: "/last.webp" };

// A controllable media decoder: seeking stays busy until the test completes it.
// That lets us exercise scroll events arriving faster than frames can decode.
class VideoDecoder extends EventTarget {
  duration = 8;
  readyState = 2;
  seeking = false;
  src = "";
  removed = false;
  requests: number[] = [];
  private playhead = 0;

  constructor(private autoLoad: boolean) { super(); }

  setAttribute() {}
  removeAttribute(name: string) { if (name === "src") this.src = ""; }
  pause() {}
  remove() { this.removed = true; }
  load() {
    if (this.autoLoad && this.src) {
      queueMicrotask(() => {
        if (this.src && !this.removed) this.dispatchEvent(new Event("loadeddata"));
      });
    }
  }
  get currentTime() { return this.playhead; }
  set currentTime(value: number) {
    assert.equal(this.seeking, false, "a busy decoder must finish before another seek");
    this.playhead = value;
    this.requests.push(value);
    this.seeking = true;
  }
  completeSeek() {
    this.seeking = false;
    this.dispatchEvent(new Event("seeked"));
  }
}

function setup(t: TestContext, { autoLoad = true } = {}) {
  let video: VideoDecoder;
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const controller = new AbortController();
  const saved = new Map<PropertyKey, PropertyDescriptor | undefined>();
  const replacements = {
    document: { createElement: () => (video = new VideoDecoder(autoLoad)) },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    },
    cancelAnimationFrame: (id: number) => { frames.delete(id); },
  };
  for (const [key, value] of Object.entries(replacements)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  t.after(() => {
    controller.abort();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const host = { appendChild() {} } as unknown as HTMLElement;
  return {
    controller,
    get video() { return video; },
    get pendingFrames() { return frames.size; },
    create: (onFailure = () => {}) => createHeroVideo(host, source, controller.signal, onFailure),
    flush() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(0));
    },
  };
}

test("scroll reversal during a busy decode lands on the latest requested frame", async (t) => {
  const h = setup(t);
  const scene = await h.create();
  scene.update(0.8, 0, 0);
  h.flush();
  assert.equal(h.video.requests.length, 1);

  scene.update(1, 0, 0);
  h.flush();
  scene.update(0.5, 0, 0);
  scene.update(0.2, 0, 0);
  h.flush();
  assert.equal(h.video.requests.length, 1, "new scroll positions wait for the decoder");

  h.video.completeSeek();
  h.flush();
  assert.equal(h.video.requests.length, 2, "intermediate positions are coalesced");
  assert.ok(Math.abs(h.video.currentTime - 1.6) < 0.04, "the reverse position wins");
  h.video.completeSeek();
  h.flush();
  assert.equal(h.pendingFrames, 0, "the renderer idles once the frame is current");
});

test("scroll boundaries show the first and last decodable frames", async (t) => {
  const h = setup(t);
  const scene = await h.create();
  scene.update(1.2, 0, 0);
  h.flush();
  assert.ok(h.video.currentTime < h.video.duration, "do not seek past the final frame");
  assert.ok(h.video.currentTime > h.video.duration - 0.1, "the final frame stays near the end");
  h.video.completeSeek();
  h.flush();

  scene.update(-0.5, 0, 0);
  h.flush();
  assert.equal(h.video.currentTime, 0);
  h.video.completeSeek();
  h.flush();
  scene.update(0, 0, 0);
  h.flush();
  assert.equal(h.video.requests.length, 2, "an unchanged position does not decode again");
});

test("a decoder error releases the media and invokes fallback once", async (t) => {
  const h = setup(t);
  let failures = 0;
  const scene = await h.create(() => { failures++; });
  scene.update(0.5, 0, 0);
  h.flush();
  h.video.dispatchEvent(new Event("error"));
  assert.equal(failures, 1);
  assert.equal(h.video.src, "", "release the media request");
  assert.equal(h.video.removed, true);

  h.video.completeSeek();
  h.video.dispatchEvent(new Event("error"));
  scene.update(0.9, 0, 0);
  h.flush();
  assert.equal(failures, 1, "late media events cannot trigger a second fallback");
  assert.equal(h.video.requests.length, 1, "disposed media cannot be sought again");
  assert.equal(h.pendingFrames, 0);
});

test("cancellation while loading rejects and releases the pending media", async (t) => {
  const h = setup(t, { autoLoad: false });
  let failures = 0;
  const loading = h.create(() => { failures++; });
  const rejected = assert.rejects(loading, { name: "AbortError" });
  h.controller.abort();
  await rejected;
  assert.equal(h.video.src, "");
  assert.equal(h.video.removed, true);
  assert.equal(failures, 0, "navigation cancellation is not a media failure");
  assert.equal(h.pendingFrames, 0);
});

test("cancellation during a seek drops pending scroll positions and late events", async (t) => {
  const h = setup(t);
  let failures = 0;
  const scene = await h.create(() => { failures++; });
  scene.update(0.5, 0, 0);
  h.flush();
  scene.update(0.9, 0, 0);
  h.controller.abort();
  h.video.completeSeek();
  h.video.dispatchEvent(new Event("error"));
  h.flush();
  assert.equal(h.video.requests.length, 1);
  assert.equal(h.video.src, "");
  assert.equal(h.video.removed, true);
  assert.equal(failures, 0);
  assert.equal(h.pendingFrames, 0);
});

test("an already cancelled load never requests the film", async (t) => {
  const h = setup(t);
  h.controller.abort();
  await assert.rejects(h.create(), { name: "AbortError" });
  assert.equal(h.video.src, "");
  assert.equal(h.video.removed, true);
  assert.equal(h.pendingFrames, 0);
});
