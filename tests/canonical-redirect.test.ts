import test from "node:test";
import assert from "node:assert/strict";
import { canonicalRedirectUrl } from "../lib/canonical-redirect";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

test("public aliases permanently target the canonical host and preserve booking and campaign parameters", () => {
  for (const host of ["www.westloopceramics.com", "detailxla-production.up.railway.app"]) {
    assert.equal(canonicalRedirectUrl(`https://${host}/booking?service=ceramic&utm_source=google&gclid=click`, "GET"),
      "https://westloopceramics.com/booking?service=ceramic&utm_source=google&gclid=click");
    assert.equal(canonicalRedirectUrl(`https://${host}/services/paint-correction/`, "HEAD"),
      "https://westloopceramics.com/services/paint-correction");
    assert.equal(canonicalRedirectUrl(`https://${host}/`, "GET"), "https://westloopceramics.com/");
  }
});

test("canonicalization leaves authenticated routes, payment returns, writes, previews, and other hosts alone", () => {
  for (const path of ["/admin", "/admin/login", "/api/webhooks/square", "/api/media/photo", "/booking/confirmation?token=private", "/review?token=private", "/unsubscribe", "/services/paint-correction/extra"]) {
    assert.equal(canonicalRedirectUrl(`https://www.westloopceramics.com${path}`, "GET"), null);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    assert.equal(canonicalRedirectUrl("https://www.westloopceramics.com/booking", method), null);
  }
  for (const host of ["westloopceramics.com", "localhost:3100", "other-preview.up.railway.app", "www.westloopceramics.com.evil.test"]) {
    assert.equal(canonicalRedirectUrl(`https://${host}/`, "GET"), null);
  }
  assert.equal(canonicalRedirectUrl("https://www.westloopceramics.com/", "GET", true), null);
});

test("Next proxy resolves the public Host when the request URL uses an internal application hostname", () => {
  const response = proxy(new NextRequest("http://localhost:3120/booking?service=ceramic&gclid=a%2Bb", {
    headers: { host: "www.westloopceramics.com" },
  }));
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://westloopceramics.com/booking?service=ceramic&gclid=a%2Bb");
  const unchanged = proxy(new NextRequest("http://localhost:3120/contact", { headers: { host: "westloopceramics.com" } }));
  assert.equal(unchanged.headers.get("location"), null);
});
