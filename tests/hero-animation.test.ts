import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createHeroAnimation } from "../components/westloop/hero-animation";
import type { HeroPlaybackState } from "../components/westloop/hero-video";

const source = { src: "/test-animation.webp", durationMs: 8500 };

// Delayed image decoding reproduces a visitor leaving or stopping before load.
class ImageDecoder {
  src = "";
  alt = "";
  removed = false;
  style = { visibility: "" };
  attributes = new Map<string, string>();
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { if (name === "src") this.src = ""; }
  remove() { this.removed = true; }
  load() { this.onload?.(); }
  fail() { this.onerror?.(); }
}

function setup(t: TestContext) {
  const controller = new AbortController();
  const images: ImageDecoder[] = [];
  const states: HeroPlaybackState[] = [];
  const progress: number[] = [];
  const urls: string[] = [];
  const revoked: string[] = [];
  const requests: { src: RequestInfo | URL; options?: RequestInit }[] = [];
  const blob = new Blob(["animation"], { type: "image/webp" });
  let failures = 0;
  let fetchResult = async (): Promise<Response> => new Response(blob);
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement(tag: string) {
        assert.equal(tag, "img");
        const image = new ImageDecoder();
        images.push(image);
        return image;
      },
    },
  });
  t.mock.method(globalThis, "fetch", async (src: RequestInfo | URL, options?: RequestInit) => {
    requests.push({ src, options });
    return fetchResult();
  });
  t.mock.method(URL, "createObjectURL", (value: Blob) => {
    assert.equal(value.type, "image/webp");
    const url = `blob:animation-${urls.length + 1}`;
    urls.push(url);
    return url;
  });
  t.mock.method(URL, "revokeObjectURL", (url: string) => revoked.push(url));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => {
    controller.abort();
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  });
  const host = { appendChild() {} } as unknown as HTMLElement;
  return {
    controller, images, states, progress, urls, revoked, requests, blob,
    get failures() { return failures; },
    get image() { return images.at(-1)!; },
    setFetchResult(result: () => Promise<Response>) { fetchResult = result; },
    create: () => createHeroAnimation(host, source, controller.signal, {
      onState: (state) => states.push(state),
      onProgress: (value) => progress.push(value),
      onFailure: () => { failures++; },
    }),
  };
}

test("the animation loads once, starts only when visible, and holds the clean finish", async (t) => {
  const h = setup(t);
  const player = await h.create();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].src, source.src);
  assert.equal(h.requests[0].options?.mode, "same-origin");
  assert.equal(h.images.length, 0);
  player.play();
  assert.equal(h.images.length, 0, "a hidden animation cannot begin");
  player.setVisible(true);
  assert.equal(h.image.style.visibility, "hidden");
  assert.equal(h.image.alt, "");
  assert.equal(h.image.attributes.get("aria-hidden"), "true");
  t.mock.timers.tick(9000);
  assert.deepEqual(h.states, [], "download/decode time is not playback time");
  h.image.load();
  assert.equal(h.image.style.visibility, "visible");
  assert.deepEqual(h.states, ["playing"]);
  t.mock.timers.tick(8499);
  assert.equal(h.image.removed, false);
  t.mock.timers.tick(1);
  assert.deepEqual(h.states, ["playing", "ended"]);
  assert.deepEqual(h.progress, [0, 1]);
  assert.equal(h.image.removed, true);
  assert.deepEqual(h.revoked, h.urls);
  player.setVisible(false);
  player.setVisible(true);
  assert.equal(h.images.length, 1, "returning cannot replay the transformation");
});

test("stop ends rather than pretending to pause an animated image; replay reuses its download", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  h.image.load();
  t.mock.timers.tick(1000);
  player.pause();
  assert.equal(h.states.at(-1), "ended");
  assert.equal(h.progress.at(-1), 1);
  assert.equal(h.image.removed, true);
  player.pause();
  t.mock.timers.tick(8500);
  assert.deepEqual(h.states, ["playing", "ended"], "the old finish timer is cancelled");
  player.play();
  assert.equal(h.requests.length, 1);
  assert.equal(h.images.length, 2);
  assert.notEqual(h.urls[0], h.urls[1], "replay receives a fresh decoder URL");
  h.image.load();
  assert.equal(h.states.at(-1), "playing");
  t.mock.timers.tick(8500);
  assert.deepEqual(h.revoked, h.urls);
});

test("leaving during image loading stops once and ignores its late load and error callbacks", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  const lateLoad = h.image.onload!;
  const lateError = h.image.onerror!;
  player.setVisible(false);
  lateLoad();
  lateError();
  player.setVisible(true);
  assert.deepEqual(h.states, ["ended"]);
  assert.deepEqual(h.progress, [1]);
  assert.equal(h.images.length, 1);
  assert.equal(h.failures, 0);
  player.play();
  h.image.load();
  lateLoad();
  lateError();
  assert.deepEqual(h.states, ["ended", "playing"]);
  assert.equal(h.failures, 0, "old callbacks cannot break a replay");
});

test("leaving during playback releases the image and requires an explicit visible replay", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  h.image.load();
  player.setVisible(false);
  player.play();
  t.mock.timers.tick(8500);
  assert.deepEqual(h.states, ["playing", "ended"]);
  assert.equal(h.images.length, 1);
  assert.equal(h.image.removed, true);
  player.setVisible(true);
  assert.equal(h.images.length, 1);
  player.play();
  assert.equal(h.images.length, 2);
});

test("abort after loading releases timers and URLs and makes late callbacks inert", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  const lateLoad = h.image.onload!;
  const lateError = h.image.onerror!;
  h.image.load();
  h.controller.abort();
  lateLoad();
  lateError();
  player.dispose();
  player.play();
  player.pause();
  t.mock.timers.tick(8500);
  assert.deepEqual(h.states, ["playing"]);
  assert.deepEqual(h.progress, [0]);
  assert.equal(h.image.src, "");
  assert.equal(h.image.removed, true);
  assert.equal(h.image.onload, null);
  assert.equal(h.image.onerror, null);
  assert.equal(h.failures, 0);
  assert.deepEqual(h.revoked, h.urls);
  assert.equal(h.requests[0].options?.signal?.aborted, true);
});

test("an image decode failure falls back once and cannot replay a broken asset", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  const lateError = h.image.onerror!;
  h.image.fail();
  lateError();
  player.play();
  player.setVisible(false);
  player.setVisible(true);
  assert.equal(h.failures, 1);
  assert.equal(h.images.length, 1);
  assert.equal(h.image.removed, true);
  assert.deepEqual(h.revoked, h.urls);
  assert.deepEqual(h.states, []);
});

test("a silent image decoder times out once and releases its URL and late callbacks", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  const lateLoad = h.image.onload!;
  const lateError = h.image.onerror!;
  t.mock.timers.tick(9999);
  assert.equal(h.failures, 0);
  assert.equal(h.image.removed, false);
  t.mock.timers.tick(1);
  assert.equal(h.failures, 1, "loading cannot leave the hero waiting indefinitely");
  assert.equal(h.image.src, "");
  assert.equal(h.image.removed, true);
  assert.deepEqual(h.revoked, h.urls);
  lateLoad();
  lateError();
  player.play();
  t.mock.timers.tick(20000);
  assert.equal(h.failures, 1);
  assert.equal(h.images.length, 1);
  assert.deepEqual(h.states, []);
  assert.deepEqual(h.progress, []);
});

test("HTTP failures reject creation for the parent fallback without emitting image failures", async (t) => {
  const h = setup(t);
  h.setFetchResult(async () => new Response(null, { status: 404 }));
  await assert.rejects(h.create(), /could not be loaded \(404\)/);
  assert.equal(h.requests[0].options?.signal?.aborted, true);
  assert.equal(h.images.length, 0);
  assert.equal(h.failures, 0);
});

test("cancellation while fetching the blob rejects and never exposes a late image", async (t) => {
  const h = setup(t);
  let finishDownload!: (blob: Blob) => void;
  h.setFetchResult(async () => ({
    ok: true,
    blob: () => new Promise<Blob>((resolve) => { finishDownload = resolve; }),
  }) as Response);
  const loading = h.create();
  const rejected = assert.rejects(loading, { name: "AbortError" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  h.controller.abort();
  assert.equal(h.requests[0].options?.signal?.aborted, true);
  finishDownload(h.blob);
  await rejected;
  assert.deepEqual(h.urls, []);
  assert.deepEqual(h.states, []);
  assert.equal(h.failures, 0);
});

test("an already cancelled animation makes no request", async (t) => {
  const h = setup(t);
  h.controller.abort();
  await assert.rejects(h.create(), { name: "AbortError" });
  assert.equal(h.requests.length, 0);
});
