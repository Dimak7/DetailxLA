import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const sharp = require("sharp");
async function capturePoster(page, canvas, path) {
  // Element screenshots auto-scroll sticky scenes; crop the unchanged viewport instead.
  const box = await canvas.boundingBox();
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
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
    await page.goto(base, { waitUntil: "networkidle" });
    const hero = page.locator('section[aria-label="The West Loop detailing transformation"]');
    await hero.locator("canvas").waitFor({ state: "visible", timeout: 45000 });
    await page.waitForFunction(() => document.querySelector('[data-status="ready"]'));
    await page.screenshot({ path: `artifacts/hero/${name}-arrival.png` });
    for (const progress of [0, .25, .5, .75, 1, 0]) {
      await hero.evaluate((root, p) => {
        const viewport = root.firstElementChild;
        window.scrollTo({ top: window.scrollY + root.getBoundingClientRect().top + p * (root.offsetHeight - viewport.offsetHeight), behavior: "instant" });
      }, progress);
      await page.waitForFunction((p) => Math.abs(Number(document.querySelector('[data-status="ready"]').style.getPropertyValue("--finish")) - p) < .005, progress, { timeout: 15000 });
      const measured = await hero.evaluate((root) => Number(root.style.getPropertyValue("--finish")));
      assert.ok(Math.abs(measured - progress) < .025, `${name} scroll progress: ${measured} != ${progress}`);
      await page.screenshot({ path: `artifacts/hero/${name}-${progress * 100}.png` });
      if (name === "desktop" && progress === 0) await capturePoster(page, hero.locator("canvas"), "artifacts/hero/dirty-render.png");
      if (name === "mobile" && [0, 1].includes(progress)) await capturePoster(page, hero.locator("canvas"), `artifacts/hero/${progress ? "clean" : "dirty"}-mobile-render.png`);
      results.push({ name, progress, measured });
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} horizontal overflow`);
    assert.equal(await hero.getByRole("link", { name: "Book your detail" }).getAttribute("href"), "/booking");
    assert.equal(await hero.getByRole("link", { name: "View our work" }).getAttribute("href"), "/gallery");
    // Capture a same-vehicle fallback from the actual renderer, never a different car.
    if (name === "desktop") {
      await hero.evaluate((root) => window.scrollTo({ top: window.scrollY + root.getBoundingClientRect().top + root.offsetHeight - root.firstElementChild.offsetHeight, behavior: "instant" }));
      await page.waitForFunction(() => Number(document.querySelector('[data-status="ready"]').style.getPropertyValue("--finish")) > .995);
      await capturePoster(page, hero.locator("canvas"), "artifacts/hero/clean-render.png");
    }
    const canvas = hero.locator("canvas");
    await canvas.evaluate((node) => node.dispatchEvent(new Event("webglcontextlost", { cancelable: true })));
    await page.waitForFunction(() => document.querySelector('[data-status="error"]'));
    assert.equal(await hero.locator("canvas").count(), 0);
    assert.equal(errors.length, 0, errors.join("\n"));
    await context.close();
  }
  for (const mode of ["reduced", "no-js", "asset-failure"]) {
    console.log(`Checking ${mode} fallback and booking navigation`);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: mode !== "no-js", reducedMotion: mode === "reduced" ? "reduce" : "no-preference" });
    const page = await context.newPage();
    if (mode === "asset-failure") await page.route("**/hero/detail-car.glb", (route) => route.fulfill({ status: 503, body: "Unavailable" }));
    await page.goto(base, { waitUntil: "networkidle" });
    const hero = page.locator('section[aria-label="The West Loop detailing transformation"]');
    if (mode === "asset-failure") await page.waitForFunction(() => document.querySelector('[data-status="error"]'));
    if (mode === "reduced") assert.equal(await hero.getAttribute("data-status"), "static");
    assert.equal(await hero.locator("canvas").count(), 0);
    await page.screenshot({ path: `artifacts/hero/${mode}.png` });
    await hero.getByRole("link", { name: "Book your detail" }).click();
    await page.waitForURL("**/booking");
    await page.locator("main h1").waitFor({ state: "visible" });
    results.push({ mode, bookingNavigation: true });
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
