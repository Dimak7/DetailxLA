import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { workAsyncStorage, type WorkStore } from "next/dist/server/app-render/work-async-storage.external";
import { POST } from "../app/api/book/route";
import { closeDatabase, database, query, type Query } from "../lib/platform/db";
import { verifyReceipt } from "../lib/platform/auth";

process.env.PGLITE_PATH = "memory://booking-route";
Object.assign(process.env, { NODE_ENV: "test" });
for (const name of ["DATABASE_URL", "RAILWAY_ENVIRONMENT", "SQUARE_ACCESS_TOKEN", "STRIPE_SECRET_KEY", "RESEND_API_KEY", "EMAIL_PROVIDER_API_KEY", "TELEGRAM_BOT_TOKEN", "TWILIO_AUTH_TOKEN", "SMS_PROVIDER_AUTH_TOKEN", "META_ACCESS_TOKEN"])
  delete process.env[name];

test("successful booking returns its receipt despite database request-context loss and retry stays idempotent", async (t) => {
  const db = await database();
  const originalQuery = db.query;
  let inRequest = false;
  let callbacks: Array<() => Promise<void>> = [];
  const store = { afterContext: { after(callback: () => Promise<void>) { callbacks.push(callback); } } } as unknown as WorkStore;
  t.mock.method(workAsyncStorage, "getStore", () => inRequest ? store : undefined);
  t.mock.method(globalThis, "fetch", async () => { throw Error("Unexpected external request"); });
  try {
    const service = (await query<{id:string}>("SELECT id FROM wl.services WHERE slug='exterior-detail'"))[0];
    const day = new Date(Date.now() + 14 * 86_400_000);
    while (day.getUTCDay() === 0) day.setUTCDate(day.getUTCDate() + 1);
    const body = {
      request_key: randomUUID(), service_id: service.id, session_id: randomUUID(),
      first_name: "Receipt", last_name: "Test", email: "receipt@example.test", phone: "+13125550123",
      make: "Test", model: "Car", year: 2026, vehicle_type: "Sedan",
      date: day.toISOString().slice(0,10), start_minute: 480, terms: true,
    };
    db.query = (async (sql, params) => { inRequest = false; return originalQuery(sql, params); }) as Query;
    const run = async (input:unknown) => {
      inRequest = true;
      callbacks = [];
      return POST(new Request("https://example.test/api/book", {
        method: "POST", headers: { Origin: "https://example.test", "Content-Type": "application/json" }, body: JSON.stringify(input),
      }));
    };
    const response = await run(body);
    assert.equal(response.status, 201);
    const saved = await response.json();
    assert.equal(saved.ok, true);
    assert.equal(callbacks.length, 1);
    const receipt = new URL(saved.confirmation_url, "https://example.test");
    assert.equal(receipt.searchParams.get("id"), saved.booking_id);
    assert.ok(await verifyReceipt(saved.booking_id, receipt.searchParams.get("token")!));
    assert.equal((await query("SELECT id FROM wl.bookings")).length, 1);
    const retry = await run(body);
    assert.equal(retry.status, 201);
    assert.equal((await retry.json()).booking_id, saved.booking_id);
    assert.equal((await query("SELECT id FROM wl.bookings")).length, 1);
    const invalid = await run({ ...body, terms: false });
    assert.equal(invalid.status, 400);
    // Registered callbacks for failures must be inert, not dispatch queued messages.
    const before = await query("SELECT id,status FROM wl.messages ORDER BY id");
    for (const callback of callbacks) await callback();
    assert.deepEqual(await query("SELECT id,status FROM wl.messages ORDER BY id"), before);
  } finally {
    db.query = originalQuery;
    await closeDatabase();
  }
});
