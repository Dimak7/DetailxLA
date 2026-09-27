import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { require: requireTs } = require("tsx/cjs/api");
const { heroVideoMedia } = requireTs("../components/westloop/hero-media.ts", import.meta.url);
const heroSelector = 'section[aria-label="West Loop Ceramics — a finish worth protecting"]';
const base = process.env.HERO_TEST_URL || "http://localhost:3107";
const results = [];
assert.ok(heroVideoMedia, "Configure reviewed hero media before running the automatic-film smoke test");

function sourceFor(width) {
  return width <= 760 ? heroVideoMedia.mobile ?? heroVideoMedia.desktop : heroVideoMedia.desktop;
}
function originalImageUrl(src, baseUrl) {
  const url = new URL(src, baseUrl);
  return url.pathname === "/_next/image" && url.searchParams.has("url")
    ? new URL(url.searchParams.get("url"), baseUrl).href : url.href;
}
async function checkPoster(page, hero, width, visible = true) {
  await page.waitForFunction(({ selector, visible }) => {
    const image = document.querySelector(`${selector} picture img`);
    return image?.complete && image.naturalWidth > 0 && (!visible || Number(getComputedStyle(image).opacity) > .99);
  }, { selector: heroSelector, visible });
  const src = await hero.locator("picture img").evaluate((image) => image.currentSrc || image.src);
  assert.equal(originalImageUrl(src, page.url()), new URL(sourceFor(width).cleanPoster, page.url()).href, "The clean still must match the configured film");
}
async function waitForState(page, state) {
  await page.waitForFunction(({ selector, state }) => document.querySelector(selector)?.dataset.status === state,
    { selector: heroSelector, state }, { timeout: 35000 });
}
async function waitForPlayback(page, state) {
  await page.waitForFunction(({ selector, state }) => document.querySelector(selector)?.dataset.playback === state,
    { selector: heroSelector, state }, { timeout: 15000 });
}
async function moveOffscreen(hero) {
  await hero.evaluate((root) => window.scrollTo({ top: window.scrollY + root.getBoundingClientRect().bottom + 100, behavior: "instant" }));
}
async function returnToHero(page) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
}
async function checkNoOverflow(page, label) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label}: horizontal overflow`);
}

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
await mkdir("artifacts/hero", { recursive: true });
try {
  const dimensions = {};
  for (const [name, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
    console.log(`Checking ${name} automatic film and playback controls`);
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: name === "mobile", hasTouch: name === "mobile" });
    const page = await context.newPage();
    const errors = [];
    const modelRequests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => { if (new URL(request.url()).pathname.endsWith("/hero/detail-car.glb")) modelRequests.push(request.url()); });
    await page.goto(base, { waitUntil: "domcontentloaded" });
    const hero = page.locator(heroSelector);
    await waitForState(page, "ready");
    await waitForPlayback(page, "playing");
    const video = hero.locator("video");
    await page.waitForFunction((selector) => {
      const film = document.querySelector(`${selector} video`);
      return film && !film.paused && film.currentTime > .05;
    }, heroSelector);
    const media = await video.evaluate((film) => ({
      src: film.currentSrc, poster: film.poster, duration: film.duration,
      width: film.videoWidth, height: film.videoHeight, muted: film.muted,
      inline: film.playsInline, loop: film.loop, fit: getComputedStyle(film).objectFit,
    }));
    assert.equal(media.src, new URL(sourceFor(width).src, page.url()).href);
    assert.equal(media.poster, new URL(sourceFor(width).poster, page.url()).href);
    assert.ok(Number.isFinite(media.duration) && media.duration > 0);
    assert.ok(media.width >= 640 && media.height >= 280, `${name}: film dimensions are too small`);
    assert.ok(media.width / media.height >= 1.6 && media.width / media.height <= 2.6, "Preserve a full-car landscape composition");
    assert.equal(media.muted, true);
    assert.equal(media.inline, true);
    assert.equal(media.loop, false, "Hold the clean finish instead of jumping back to dirt");
    assert.equal(media.fit, "contain", "Do not crop bumpers or wheels to fill the hero");
    dimensions[name] = media;
    await checkPoster(page, hero, width, false);
    const layout = await hero.evaluate((root) => ({
      height: root.getBoundingClientRect().height,
      sticky: [root, ...root.querySelectorAll("*")].some((element) => getComputedStyle(element).position === "sticky"),
    }));
    assert.equal(layout.sticky, false, "The hero must not pin a scroll sequence");
    assert.ok(layout.height <= Math.max(800, height * 1.3), "The hero must remain one normal content section");
    assert.deepEqual(modelRequests, [], "The film must not also download a 3D model");
    assert.equal(await hero.getByRole("link", { name: "Explore ceramic coatings" }).getAttribute("href"), "/services/ceramic-coating");
    assert.equal(await hero.getByRole("link", { name: "Book your detail" }).getAttribute("href"), "/booking");
    await page.screenshot({ path: `artifacts/hero/${name}-playing.png` });

    await hero.getByRole("button", { name: "Pause film", exact: true }).click();
    await waitForPlayback(page, "paused");
    const pausedAt = await video.evaluate((film) => film.currentTime);
    await page.mouse.wheel(0, 70);
    await page.waitForTimeout(300);
    assert.ok(Math.abs(await video.evaluate((film) => film.currentTime) - pausedAt) < .08, "Scrolling must not move the paused playhead");
    await moveOffscreen(hero);
    await returnToHero(page);
    await page.waitForTimeout(250);
    assert.equal(await video.evaluate((film) => film.paused), true, "Returning must respect the visitor's pause");
    await hero.getByRole("button", { name: "Play film", exact: true }).click();
    await waitForPlayback(page, "playing");
    await moveOffscreen(hero);
    await page.waitForFunction((selector) => document.querySelector(`${selector} video`)?.paused, heroSelector);
    const hiddenAt = await video.evaluate((film) => film.currentTime);
    await page.waitForTimeout(300);
    assert.ok(Math.abs(await video.evaluate((film) => film.currentTime) - hiddenAt) < .08, "Offscreen playback must stop");
    await returnToHero(page);
    await waitForPlayback(page, "playing");

    // Finish through real playback and native ended events, without a long test delay.
    await video.evaluate((film) => { film.playbackRate = 4; });
    await waitForPlayback(page, "ended");
    assert.equal(await video.evaluate((film) => film.paused), true);
    assert.equal(await hero.getByRole("progressbar", { name: "Detailing film progress" }).getAttribute("aria-valuenow"), "100");
    await page.waitForTimeout(350);
    assert.ok(await video.evaluate((film) => film.currentTime >= film.duration - .05), "The polished final frame must remain held");
    await page.screenshot({ path: `artifacts/hero/${name}-finish.png` });
    await video.evaluate((film) => { film.playbackRate = 1; });
    await hero.getByRole("button", { name: "Replay film", exact: true }).click();
    await waitForPlayback(page, "playing");
    assert.ok(await video.evaluate((film) => film.currentTime < 1.5), "Replay must restart the film");
    await checkNoOverflow(page, name);

    await video.evaluate((film) => film.dispatchEvent(new Event("error")));
    await waitForState(page, "error");
    assert.equal(await hero.locator("video,canvas").count(), 0);
    await checkPoster(page, hero, width);
    await hero.getByRole("button", { name: "Retry film" }).click();
    await waitForState(page, "ready");
    await waitForPlayback(page, "playing");
    assert.deepEqual(errors, []);
    results.push({ name, media, layout, automaticPlayback: true, manualPause: true, offscreenPause: true, heldFinish: true, replay: true, retry: true });
    await context.close();
  }
  assert.ok(dimensions.mobile.width <= dimensions.desktop.width, "The mobile encode should not be larger than desktop");
  assert.ok(Math.abs(dimensions.mobile.width / dimensions.mobile.height - dimensions.desktop.width / dimensions.desktop.height) < .02, "Desktop and mobile must keep the same full-car composition");

  for (const mode of ["reduced", "save-data", "no-js", "asset-failure", "autoplay-blocked"]) {
    console.log(`Checking ${mode} fallback and navigation`);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: mode !== "no-js", reducedMotion: mode === "reduced" ? "reduce" : "no-preference" });
    const page = await context.newPage();
    let assetRequests = 0;
    const assetUrl = new URL(sourceFor(390).src, base).href;
    page.on("request", (request) => { if (request.url() === assetUrl) assetRequests++; });
    if (mode === "save-data") await page.addInitScript(() => Object.defineProperty(navigator, "connection", { configurable: true, value: { saveData: true } }));
    if (mode === "asset-failure") await page.route(assetUrl, (route) => route.fulfill({ status: 503, body: "Unavailable" }));
    if (mode === "autoplay-blocked") await page.addInitScript((selector) => {
      const nativePlay = HTMLMediaElement.prototype.play;
      let blocked = false;
      HTMLMediaElement.prototype.play = function () {
        if (!blocked && this.closest(selector)) { blocked = true; return Promise.reject(new DOMException("Autoplay blocked for verification", "NotAllowedError")); }
        return nativePlay.call(this);
      };
    }, heroSelector);
    await page.goto(base, { waitUntil: "networkidle" });
    const hero = page.locator(heroSelector);
    if (mode === "autoplay-blocked") {
      await waitForState(page, "ready");
      await waitForPlayback(page, "blocked");
      await hero.getByRole("button", { name: "Play film", exact: true }).click();
      await waitForPlayback(page, "playing");
      assert.equal(await hero.locator("video").evaluate((film) => film.paused), false);
    } else {
      if (["reduced", "save-data"].includes(mode)) await waitForState(page, "static");
      if (mode === "asset-failure") {
        await waitForState(page, "error");
        assert.ok(assetRequests > 0, "The failure test must intercept the configured media");
      } else assert.equal(assetRequests, 0, `${mode}: the film should not download`);
      assert.equal(await hero.locator("video,canvas").count(), 0);
      await checkPoster(page, hero, 390);
    }
    await page.screenshot({ path: `artifacts/hero/${mode}.png` });
    await hero.getByRole("link", { name: "Book your detail" }).click();
    await page.waitForURL("**/booking");
    await page.locator("main h1").waitFor({ state: "visible" });
    results.push({ mode, bookingNavigation: true });
    await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  for (const path of ["/", "/services", "/services/ceramic-coating", "/booking", "/gallery", "/contact"]) {
    console.log(`Checking ${path} button contrast and mobile overflow`);
    await page.goto(base + path, { waitUntil: "networkidle" });
    const contrast = await page.locator(`.mobile-bar .button, .service-book, .filter-row button, ${heroSelector} a, ${heroSelector} button`).evaluateAll((elements) => {
      const rgb = (text) => text.match(/[\d.]+/g).slice(0, 3).map(Number);
      const luminance = (color) => color.map((v) => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
      return elements.filter((element) => element.getClientRects().length).map((el) => {
        let bg = el;
        while (bg.parentElement && getComputedStyle(bg).backgroundColor === "rgba(0, 0, 0, 0)") bg = bg.parentElement;
        const fgL = luminance(rgb(getComputedStyle(el).color)), bgL = luminance(rgb(getComputedStyle(bg).backgroundColor));
        return { label: el.textContent.trim(), ratio: (Math.max(fgL, bgL) + .05) / (Math.min(fgL, bgL) + .05) };
      });
    });
    for (const item of contrast) assert.ok(item.ratio >= 4.5, `${path}: ${item.label} contrast ${item.ratio.toFixed(2)}`);
    await checkNoOverflow(page, path);
    results.push({ path, contrastChecked: contrast.length, horizontalOverflow: false });
  }
  await context.close();
  for (const [width, height] of [[320, 667], [844, 390]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(base, { waitUntil: "networkidle" });
    await page.screenshot({ path: `artifacts/hero/compact-${width}.png` });
    await checkNoOverflow(page, `${width}×${height}`);
    await page.locator(heroSelector).getByRole("link", { name: "Explore ceramic coatings" }).click();
    await page.waitForURL("**/services/ceramic-coating");
    await page.locator("main h1").waitFor({ state: "visible" });
    results.push({ width, height, ceramicNavigation: true, horizontalOverflow: false });
    await context.close();
  }
  await writeFile("artifacts/hero/results.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: true, results }, null, 2));
} finally { await browser.close(); }
