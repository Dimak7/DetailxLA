import assert from "node:assert/strict";
import test from "node:test";
import { assertOrigin } from "../lib/platform/auth";

test("Railway accepts both public site hosts without trusting arbitrary forwarded hosts", () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  const previousRailway = process.env.RAILWAY_PUBLIC_DOMAIN;
  process.env.NEXT_PUBLIC_SITE_URL = "https://westloopceramics.com";
  const request = (origin: string, fetchSite = "same-origin") => new Request("http://internal.railway:8080/api/admin/login", {
    method: "POST", headers: { origin, "sec-fetch-site": fetchSite, "x-forwarded-host": "attacker.example" },
  });
  try {
    assert.doesNotThrow(() => assertOrigin(request("https://westloopceramics.com")));
    assert.doesNotThrow(() => assertOrigin(request("https://www.westloopceramics.com")));
    for (const origin of ["https://attacker.example", "https://westloopceramics.com.attacker.example", "http://www.westloopceramics.com", "https://www.westloopceramics.com:444"]) {
      assert.throws(() => assertOrigin(request(origin)), /Invalid request origin/);
    }
    assert.throws(() => assertOrigin(request("https://www.westloopceramics.com", "cross-site")), /Invalid request origin/);
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.westloopceramics.com";
    assert.doesNotThrow(() => assertOrigin(request("https://westloopceramics.com")));
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.RAILWAY_PUBLIC_DOMAIN = "westloopceramics.com";
    assert.doesNotThrow(() => assertOrigin(request("https://www.westloopceramics.com")));
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
    if (previousRailway === undefined) delete process.env.RAILWAY_PUBLIC_DOMAIN;
    else process.env.RAILWAY_PUBLIC_DOMAIN = previousRailway;
  }
});
