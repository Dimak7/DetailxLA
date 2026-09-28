import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createHeroAnimation } from "../components/westloop/hero-animation";
import type { HeroPlaybackState } from "../components/westloop/hero-video";

const source = { src: "/test-animation.webp", durationMs: 8500 };

// Delayed image decoding reproduces a visitor leaving or stopping before load.
class ImageDecoder {
  src = "";
  alt = "";
  fetchPriority = "auto";
  loading = "auto";
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
  let fetchResult = async (): Promise<Response> => ({ ok: true, blob: async () => blob }) as Response;
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

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferredBlob(h: ReturnType<typeof setup>) {
  let complete!: (blob: Blob) => void;
  h.setFetchResult(async () => ({
    ok: true,
    blob: () => new Promise<Blob>((resolve) => { complete = resolve; }),
  }) as Response);
  return { complete: () => complete(h.blob) };
}

test("initial playback attaches its direct image immediately without a blob-fetch or load gate", async (t) => {
  const h = setup(t);
  const player = await h.create();
  assert.equal(h.requests.length, 0);
  assert.equal(h.images.length, 0);
  player.play();
  assert.equal(h.images.length, 0, "a hidden animation cannot begin");
  player.setVisible(true);
  assert.equal(h.image.src, source.src);
  assert.equal(h.image.fetchPriority, "high");
  assert.equal(h.image.loading, "eager");
  assert.equal(h.image.style.visibility, "visible");
  assert.equal(h.image.alt, "");
  assert.equal(h.image.attributes.get("aria-hidden"), "true");
  assert.deepEqual(h.states, ["playing"], "the canvas must reveal streamed frames before onload");
  assert.deepEqual(h.progress, [0]);
  assert.equal(h.requests.length, 0, "the image itself is the only initial asset request");
  assert.deepEqual(h.urls, []);
  t.mock.timers.tick(9000);
  assert.deepEqual(h.states, ["playing"], "download time must not consume the final-hold timer");
  h.image.load();
  t.mock.timers.tick(8499);
  assert.equal(h.image.removed, false, "onload clears the earlier image-failure deadline");
  t.mock.timers.tick(1);
  assert.deepEqual(h.states, ["playing", "ended"]);
  assert.deepEqual(h.progress, [0, 1]);
  assert.equal(h.image.removed, true);
  player.setVisible(false);
  player.setVisible(true);
  assert.equal(h.images.length, 1, "returning cannot replay the transformation");
});

test("replay cache-loads one blob and uses a fresh URL for each later play", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  h.image.load();
  player.pause();
  assert.deepEqual(h.states, ["playing", "ended"]);
  player.play();
  player.play();
  assert.equal(h.requests.length, 1, "duplicate Replay clicks cannot duplicate the pending fetch");
  assert.equal(h.requests[0].src, source.src);
  assert.equal(h.requests[0].options?.mode, "same-origin");
  assert.equal(h.requests[0].options?.cache, "force-cache");
  await settle();
  assert.equal(h.images.length, 2);
  assert.equal(h.image.src, h.urls[0]);
  assert.deepEqual(h.states, ["playing", "ended", "playing"]);
  h.image.load();
  t.mock.timers.tick(source.durationMs);
  assert.equal(h.states.at(-1), "ended");
  player.play();
  assert.equal(h.requests.length, 1, "later replays reuse the cached blob");
  assert.equal(h.images.length, 3);
  assert.notEqual(h.urls[0], h.urls[1], "a fresh decoder URL reliably restarts the image");
  h.image.load();
  t.mock.timers.tick(source.durationMs);
  assert.deepEqual(h.revoked, h.urls);
});

test("leaving during initial loading stops once and ignores its callbacks during a replay", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  const lateLoad = h.image.onload!;
  const lateError = h.image.onerror!;
  player.setVisible(false);
  lateLoad();
  lateError();
  t.mock.timers.tick(10000);
  player.setVisible(true);
  assert.deepEqual(h.states, ["playing", "ended"]);
  assert.deepEqual(h.progress, [0, 1]);
  assert.equal(h.images.length, 1);
  assert.equal(h.failures, 0);
  player.play();
  await settle();
  lateLoad();
  lateError();
  assert.deepEqual(h.states, ["playing", "ended", "playing"]);
  assert.equal(h.failures, 0, "the old image cannot break a replay");
});

test("leaving during playback releases the image and requires an explicit visible replay", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  h.image.load();
  player.setVisible(false);
  player.play();
  t.mock.timers.tick(source.durationMs);
  assert.deepEqual(h.states, ["playing", "ended"]);
  assert.equal(h.requests.length, 0, "a hidden Replay request cannot start a blob fetch");
  assert.equal(h.image.removed, true);
  player.setVisible(true);
  assert.equal(h.images.length, 1);
  player.play();
  await settle();
  assert.equal(h.images.length, 2);
});

test("abort during initial decoding clears timers and makes late image events inert", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  const lateLoad = h.image.onload!;
  const lateError = h.image.onerror!;
  h.controller.abort();
  lateLoad();
  lateError();
  player.dispose();
  player.play();
  player.pause();
  t.mock.timers.tick(20000);
  assert.deepEqual(h.states, ["playing"]);
  assert.deepEqual(h.progress, [0]);
  assert.equal(h.image.src, "");
  assert.equal(h.image.removed, true);
  assert.equal(h.image.onload, null);
  assert.equal(h.image.onerror, null);
  assert.equal(h.failures, 0);
  assert.equal(h.requests.length, 0);
});

test("an image failure falls back once without attempting another asset request", async (t) => {
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
  assert.equal(h.requests.length, 0);
  assert.deepEqual(h.states, ["playing"]);
});

test("a silent decoder fails at ten seconds rather than leaving the image active forever", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  const lateLoad = h.image.onload!;
  const lateError = h.image.onerror!;
  t.mock.timers.tick(9999);
  assert.equal(h.failures, 0);
  assert.equal(h.image.removed, false);
  t.mock.timers.tick(1);
  assert.equal(h.failures, 1);
  assert.equal(h.image.src, "");
  assert.equal(h.image.removed, true);
  lateLoad();
  lateError();
  player.play();
  t.mock.timers.tick(20000);
  assert.equal(h.failures, 1);
  assert.equal(h.images.length, 1);
  assert.deepEqual(h.states, ["playing"]);
});

test("a replay image timeout revokes its blob URL once", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  player.pause();
  player.play();
  await settle();
  assert.equal(h.urls.length, 1);
  t.mock.timers.tick(10000);
  assert.equal(h.failures, 1);
  assert.deepEqual(h.revoked, h.urls);
});

test("a replay fetch that never responds fails once at fifteen seconds", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  player.pause();
  let complete!: (response: Response) => void;
  h.setFetchResult(() => new Promise<Response>((resolve) => { complete = resolve; }));
  player.play();
  t.mock.timers.tick(14999);
  assert.equal(h.failures, 0);
  assert.equal(h.requests[0].options?.signal?.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(h.failures, 1);
  assert.equal(h.requests[0].options?.signal?.aborted, true);
  complete({ ok: true, blob: async () => h.blob } as Response);
  await settle();
  player.play();
  t.mock.timers.tick(30000);
  assert.equal(h.failures, 1, "late completion cannot trigger a second fallback");
  assert.equal(h.images.length, 1);
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.urls, []);
});

test("the replay deadline also bounds a response whose blob never finishes", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  player.pause();
  const pending = deferredBlob(h);
  player.play();
  await settle();
  t.mock.timers.tick(14999);
  assert.equal(h.failures, 0);
  t.mock.timers.tick(1);
  assert.equal(h.failures, 1);
  assert.equal(h.requests[0].options?.signal?.aborted, true);
  pending.complete();
  await settle();
  t.mock.timers.tick(30000);
  assert.equal(h.failures, 1);
  assert.equal(h.images.length, 1);
  assert.deepEqual(h.urls, []);
});

test("a cancelled replay deadline and late completion cannot affect a newer deadline", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  player.pause();
  const oldDownload = deferredBlob(h);
  player.play();
  await settle();
  t.mock.timers.tick(10000);
  player.pause();
  const newDownload = deferredBlob(h);
  player.play();
  await settle();
  t.mock.timers.tick(5000);
  assert.equal(h.failures, 0, "the cancelled replay's deadline must not fail its replacement");
  assert.equal(h.requests[1].options?.signal?.aborted, false);
  oldDownload.complete();
  await settle();
  t.mock.timers.tick(9999);
  assert.equal(h.failures, 0);
  t.mock.timers.tick(1);
  assert.equal(h.failures, 1, "old cleanup must not cancel the replacement's deadline");
  assert.equal(h.requests[1].options?.signal?.aborted, true);
  newDownload.complete();
  await settle();
  assert.equal(h.images.length, 1);
  assert.deepEqual(h.urls, []);
});

test("stopping while replay downloads aborts its request and ignores a late blob", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  player.pause();
  const pending = deferredBlob(h);
  player.play();
  await settle();
  player.pause();
  assert.equal(h.requests[0].options?.signal?.aborted, true);
  pending.complete();
  await settle();
  assert.equal(h.images.length, 1);
  assert.deepEqual(h.urls, []);
  assert.equal(h.states.at(-1), "ended");
  assert.equal(h.failures, 0);
});

test("leaving during a replay fetch cannot expose its late image after returning", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  player.pause();
  const pending = deferredBlob(h);
  player.play();
  await settle();
  player.setVisible(false);
  player.setVisible(true);
  pending.complete();
  await settle();
  assert.equal(h.requests[0].options?.signal?.aborted, true);
  assert.equal(h.images.length, 1);
  assert.equal(h.failures, 0);
});

test("an old replay download cannot replace a newer replay", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  player.pause();
  const oldDownload = deferredBlob(h);
  player.play();
  await settle();
  player.pause();
  const newDownload = deferredBlob(h);
  player.play();
  await settle();
  oldDownload.complete();
  await settle();
  assert.equal(h.images.length, 1);
  player.play();
  assert.equal(h.requests.length, 2, "the old completion cannot clear the newer pending guard");
  newDownload.complete();
  await settle();
  assert.equal(h.images.length, 2);
  assert.equal(h.urls.length, 1);
  assert.equal(h.states.at(-1), "playing");
});

test("aborting during replay fetch prevents late image creation and further requests", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  player.pause();
  const pending = deferredBlob(h);
  player.play();
  await settle();
  h.controller.abort();
  pending.complete();
  await settle();
  player.play();
  assert.equal(h.requests[0].options?.signal?.aborted, true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.images.length, 1);
  assert.deepEqual(h.urls, []);
  assert.equal(h.failures, 0);
});

test("a failed replay download reports fallback once instead of rejecting creation", async (t) => {
  const h = setup(t);
  const player = await h.create();
  player.setVisible(true);
  player.pause();
  h.setFetchResult(async () => new Response(null, { status: 404 }));
  player.play();
  await settle();
  assert.equal(h.failures, 1);
  assert.equal(h.requests[0].options?.signal?.aborted, true);
  assert.equal(h.images.length, 1);
  player.play();
  assert.equal(h.requests.length, 1);
});

test("an already cancelled animation makes no request or image", async (t) => {
  const h = setup(t);
  h.controller.abort();
  await assert.rejects(h.create(), { name: "AbortError" });
  assert.equal(h.requests.length, 0);
  assert.equal(h.images.length, 0);
});
