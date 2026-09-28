import test from "node:test";
import assert from "node:assert/strict";
import { adminAction, adminData } from "../lib/platform/admin";
import { closeDatabase, query } from "../lib/platform/db";
import { POST as manage } from "../app/api/manage/route";
import { POST as jobs } from "../app/api/jobs/route";
import type { Session } from "../lib/platform/types";

process.env.PGLITE_PATH = "memory://square-access";
Object.assign(process.env, { NODE_ENV: "test" });
delete process.env.DATABASE_URL;
delete process.env.RAILWAY_ENVIRONMENT;
process.env.SQUARE_ENVIRONMENT = "production";
process.env.SQUARE_ACCESS_TOKEN = "square-access-test-token";
process.env.CRON_SECRET = "square-access-test-cron-secret";

test("Square synchronization requires financial access and only reads the configured account", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(init?.method, "GET");
    const url = new URL(String(input));
    assert.equal(url.origin, "https://connect.squareup.com");
    requests.push(url.pathname);
    if (url.pathname === "/v2/locations") return Response.json({ locations: [{ id: "TEST_LOCATION" }] });
    assert.equal(url.pathname, "/v2/payments");
    return Response.json({ payments: [] });
  };
  const manager: Session = { id: "test-session", user_id: "00000000-0000-0000-0000-000000000001", name: "Test Manager", email: "manager@example.test", role: "manager" };
  const request = (headers: Record<string, string> = {}) => new Request("https://example.test/api/manage", {
    method: "POST", headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ action: "sync_square_payments", data: {} }),
  });
  try {
    assert.equal((await manage(request())).status, 401);
    assert.equal((await manage(request({ Origin: "https://other.example" }))).status, 403);
    assert.equal((await jobs(new Request("https://example.test/api/jobs", { method: "POST" }))).status, 401);
    assert.equal((await jobs(new Request("https://example.test/api/jobs", { method: "POST", headers: { Authorization: "Bearer wrong" } }))).status, 401);
    await assert.rejects(() => adminAction("sync_square_payments", {}, { ...manager, role: "staff" }), /cannot perform/);
    await assert.rejects(() => adminData("payments", new URLSearchParams(), { ...manager, role: "staff" }), /access/);
    assert.equal(requests.length, 0, "Denied requests must not contact Square");

    const result = await adminAction("sync_square_payments", { environment: "sandbox" }, manager) as { environment: string; complete: boolean };
    assert.equal(result.environment, "production", "The client cannot override the configured Square environment");
    assert.equal(result.complete, true);
    assert.deepEqual(requests, ["/v2/locations", "/v2/payments"]);
    assert.equal((await query("SELECT id FROM wl.bookings")).length, 0);
    assert.equal((await query("SELECT id FROM wl.customers")).length, 0);
    for (const squarePage of ["Infinity", "1.5", "0", "not-a-number"])
      await assert.rejects(() => adminData("payments", new URLSearchParams({ squarePage }), manager), /valid Square payment page/);
  } finally {
    globalThis.fetch = originalFetch;
    await closeDatabase();
  }
});
