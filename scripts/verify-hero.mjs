import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const sharp = require("sharp");
const { require: requireTs } = require("tsx/cjs/api");
const { heroVideoMedia } = requireTs("../components/westloop/hero-media.ts", import.meta.url);
const heroSelector = 'section[aria-label="The West Loop detailing transformation"]';
const observedAssets = new Map();

function expectedPoster(renderer, width, clean) {
  if (renderer === "video") {
    const source = width <= 760 ? heroVideoMedia?.mobile ?? heroVideoMedia?.desktop : heroVideoMedia?.desktop;
    assert.ok(source, "The local hero-media config must match the video deployment being checked");
    return clean ? source.cleanPoster : source.poster;
  }
  return `/hero/poster${clean ? "-clean" : ""}${width <= 760 ? "-mobile" : ""}.webp`;
}

function originalImageUrl(src, base) {
  const url = new URL(src, base);
  // next/image optimizes the desktop poster; <picture> can serve the mobile file directly.
  return url.pathname === "/_next/image" && url.searchParams.has("url")
    ? new URL(url.searchParams.get("url"), base).href
    : url.href;
}

async function checkPoster(page, hero, expected, visible = true) {
  const poster = hero.locator("picture img");
  await page.waitForFunction(({ selector, visible }) => {
    const image = document.querySelector(`${selector} picture img`);
    return image?.complete && image.naturalWidth > 0 && (!visible || Number(getComputedStyle(image).opacity) > .99);
  }, { selector: heroSelector, visible });
  const src = await poster.evaluate((image) => image.currentSrc || image.src);
  assert.equal(originalImageUrl(src, page.url()), new URL(expected, page.url()).href, "Hero poster must match its configured media");
}

async function scrollToProgress(page, hero, renderer, progress) {
  await hero.evaluate((root, p) => {
    const viewport = root.firstElementChild;
    window.scrollTo({ top: window.scrollY + root.getBoundingClientRect().top + p * (root.offsetHeight - viewport.offsetHeight), behavior: "instant" });
  }, progress);
  await page.waitForFunction(({ selector, progress }) => {
    const root = document.querySelector(selector);
    return root?.dataset.status === "ready" && Math.abs(Number(root.style.getPropertyValue("--finish")) - progress) < .005;
  }, { selector: heroSelector, progress }, { timeout: 15000 });
  const measured = await hero.evaluate((root) => Number(root.style.getPropertyValue("--finish")));
  assert.ok(Math.abs(measured - progress) < .025, `Scroll progress: ${measured} != ${progress}`);
  if (renderer !== "video") return { measured };

  // Wait for the decoder to finish seeking to this scroll position, including on the way back.
  // Allow a few frames for encoded end-frame and scroll-smoothing differences.
  await page.waitForFunction(({ selector, progress }) => {
    const video = document.querySelector(`${selector} video`);
    return video && Number.isFinite(video.duration) && video.duration > 0 && video.readyState >= 2 &&
      !video.seeking && video.paused && Math.abs(video.currentTime - progress * video.duration) < Math.max(.1, video.duration * .007);
  }, { selector: heroSelector, progress }, { timeout: 15000 });
  const media = await hero.locator("video").evaluate((video) => ({
    currentTime: video.currentTime, duration: video.duration, readyState: video.readyState,
    paused: video.paused, autoplay: video.autoplay, seeking: video.seeking,
  }));
  assert.equal(media.autoplay, false, "Scroll-driven video must not autoplay");
  return { measured, ...media };
}

async function capturePoster(page, media, path) {
  // Element screenshots auto-scroll sticky scenes; crop the unchanged viewport instead.
  const box = await media.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, "Hero renderer needs a visible capture area");
  const viewport = page.viewportSize();
  const left = Math.max(0, Math.ceil(box.x)), top = Math.max(0, Math.ceil(box.y));
  const width = Math.min(viewport.width, Math.floor(box.x + box.width)) - left;
  const height = Math.min(viewport.height, Math.floor(box.y + box.height)) - top;
  const buffer = await page.screenshot({ style: "[class*='studioLabel'], [class*='credit'], [class*='CinematicHero'][class*='heading'] { visibility: hidden !important; }" });
  await sharp(buffer).extract({ left, top, width, height }).png().toFile(path);
}
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const base = process.env.HERO_TEST_URL || "http://localhost:3107";
await mkdir("artifacts/hero", { recursive: true });
const results = [];
try {
  for (const [name, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
    console.log(`Checking ${name} scroll-driven rendering`);
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: name === "mobile", hasTouch: name === "mobile" });
    const page = await context.newPage();
    const errors = [];
    const modelRequests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
    page.on("request", (request) => { if (new URL(request.url()).pathname.endsWith("/hero/detail-car.glb")) modelRequests.push(request.url()); });
    await page.addInitScript((selector) => {
      window.__heroPlaybackStarts = 0;
      document.addEventListener("play", (event) => {
        if (event.target instanceof HTMLVideoElement && event.target.closest(selector)) window.__heroPlaybackStarts += 1;
      }, true);
    }, heroSelector);
    await page.goto(base, { waitUntil: "networkidle" });
    const hero = page.locator(heroSelector);
    const renderer = await hero.getAttribute("data-renderer");
    assert.ok(["video", "3d"].includes(renderer), `Unknown hero renderer: ${renderer}`);
    const media = hero.locator(renderer === "video" ? "video" : "canvas");
    await media.waitFor({ state: "visible", timeout: 45000 });
    await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.status === "ready", heroSelector);
    await checkPoster(page, hero, expectedPoster(renderer, width, false), false);
    if (renderer === "video") {
      const video = await media.evaluate((node) => ({ src: node.currentSrc, poster: node.poster, duration: node.duration, readyState: node.readyState, paused: node.paused, autoplay: node.autoplay }));
      assert.ok(video.src && Number.isFinite(video.duration) && video.duration > 0 && video.readyState >= 2, `${name} video needs a decoded frame and finite duration`);
      assert.equal(video.paused, true, `${name} video must remain paused`);
      assert.equal(video.autoplay, false);
      assert.equal(video.poster, new URL(expectedPoster(renderer, width, false), page.url()).href);
      observedAssets.set(name, { renderer, src: video.src });
    } else {
      assert.ok(modelRequests.length, `${name} did not request its 3D model`);
      observedAssets.set(name, { renderer, src: modelRequests[0] });
    }
    await page.screenshot({ path: `artifacts/hero/${name}-arrival.png` });
    for (const [step, progress] of [0, .25, .5, .75, 1, .75, .5, .25, 0].entries()) {
      const measured = await scrollToProgress(page, hero, renderer, progress);
      await page.screenshot({ path: `artifacts/hero/${name}-${step}-${progress * 100}.png` });
      if (name === "desktop" && step === 0) await capturePoster(page, media, "artifacts/hero/dirty-render.png");
      if (name === "mobile" && (step === 0 || progress === 1)) await capturePoster(page, media, `artifacts/hero/${progress ? "clean" : "dirty"}-mobile-render.png`);
      results.push({ name, renderer, progress, direction: step === 0 ? "start" : step <= 4 ? "forward" : "reverse", ...measured });
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} horizontal overflow`);
    assert.equal(await hero.getByRole("link", { name: "Book your detail" }).getAttribute("href"), "/booking");
    assert.equal(await hero.getByRole("link", { name: "View our work" }).getAttribute("href"), "/gallery");
    // Capture a same-vehicle fallback from the actual renderer, never a different car.
    if (name === "desktop") {
      await scrollToProgress(page, hero, renderer, 1);
      await capturePoster(page, media, "artifacts/hero/clean-render.png");
    }
    assert.equal(await page.evaluate(() => window.__heroPlaybackStarts), 0, `${name} video started playback without a scroll seek`);
    await media.evaluate((node, type) => node.dispatchEvent(new Event(type, { cancelable: true })), renderer === "video" ? "error" : "webglcontextlost");
    await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.status === "error", heroSelector);
    assert.equal(await hero.locator("canvas, video").count(), 0);
    await checkPoster(page, hero, expectedPoster(renderer, width, true));
    assert.equal(errors.length, 0, errors.join("\n"));
    await context.close();
  }
  for (const mode of ["reduced", "save-data", "no-js", "asset-failure"]) {
    console.log(`Checking ${mode} fallback and booking navigation`);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: mode !== "no-js", reducedMotion: mode === "reduced" ? "reduce" : "no-preference" });
    const page = await context.newPage();
    if (mode === "save-data") await page.addInitScript(() => Object.defineProperty(navigator, "connection", { configurable: true, value: { saveData: true } }));
    let blockedRequests = 0;
    if (mode === "asset-failure") {
      const asset = observedAssets.get("mobile");
      assert.ok(asset?.src, "Observe the mobile hero asset before testing its failure");
      await page.route((url) => url.href === asset.src, (route) => { blockedRequests += 1; return route.fulfill({ status: 503, body: "Unavailable" }); });
    }
    await page.goto(base, { waitUntil: "networkidle" });
    const hero = page.locator(heroSelector);
    const renderer = await hero.getAttribute("data-renderer");
    if (mode === "asset-failure") {
      await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.status === "error", heroSelector);
      assert.ok(blockedRequests > 0, "Asset-failure check must actually intercept the configured hero asset");
    }
    if (["reduced", "save-data"].includes(mode)) await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.status === "static", heroSelector);
    assert.equal(await hero.locator("canvas, video").count(), 0);
    await checkPoster(page, hero, expectedPoster(renderer, 390, mode !== "no-js"));
    await page.screenshot({ path: `artifacts/hero/${mode}.png` });
    await hero.getByRole("link", { name: "Book your detail" }).click();
    await page.waitForURL("**/booking");
    await page.locator("main h1").waitFor({ state: "visible" });
    results.push({ mode, renderer, matchingPoster: true, bookingNavigation: true });
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  for (const path of ["/", "/services", "/booking", "/gallery", "/contact"]) {
    console.log(`Checking ${path} button contrast and mobile overflow`);
    await page.goto(base + path, { waitUntil: "networkidle" });
    const contrast = await page.locator(".mobile-bar .button, .service-book, .filter-row button, section[aria-label='The West Loop detailing transformation'] a").evaluateAll((elements) => {
      const rgb = (text) => text.match(/[\d.]+/g).slice(0, 3).map(Number);
      const luminance = (color) => color.map((v) => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
      return elements.map((el) => {
        let bg = el;
        while (bg.parentElement && getComputedStyle(bg).backgroundColor === "rgba(0, 0, 0, 0)") bg = bg.parentElement;
        const fgL = luminance(rgb(getComputedStyle(el).color)), bgL = luminance(rgb(getComputedStyle(bg).backgroundColor));
        return { label: el.textContent.trim(), ratio: (Math.max(fgL, bgL) + .05) / (Math.min(fgL, bgL) + .05) };
      });
    });
    for (const item of contrast) assert.ok(item.ratio >= 4.5, `${path}: ${item.label} contrast ${item.ratio.toFixed(2)}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, path + " overflow");
    results.push({ path, contrastChecked: contrast.length, horizontalOverflow: false });
  }
  await context.close();
  for (const [width, height] of [[320, 667], [844, 390]]) {
    console.log(`Checking compact layout ${width}x${height}`);
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(base, { waitUntil: "networkidle" });
    const hero = page.locator('section[aria-label="The West Loop detailing transformation"]');
    await page.screenshot({ path: `artifacts/hero/compact-${width}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await hero.getByRole("link", { name: "Book your detail" }).click();
    await page.waitForURL("**/booking");
    results.push({ width, height, bookingNavigation: true, horizontalOverflow: false });
    await context.close();
  }
  await writeFile("artifacts/hero/results.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: true, results }, null, 2));
} finally { await browser.close(); }
