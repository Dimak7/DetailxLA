import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  capacityAvailable,
  createBooking,
  availability,
} from "../lib/platform/bookings";
import { query, closeDatabase } from "../lib/platform/db";
process.env.PGLITE_PATH = "memory://capacity";
Object.assign(process.env, {
  NODE_ENV: "test",
  ADMIN_EMAIL: "capacity@example.test",
  ADMIN_PASSWORD: "test-only-capacity-password-long",
});
for (const key of [
  "DATABASE_URL",
  "RAILWAY_ENVIRONMENT",
  "TELEGRAM_BOT_TOKEN",
  "STRIPE_SECRET_KEY",
  "SQUARE_ACCESS_TOKEN",
  "RESEND_API_KEY",
  "TWILIO_AUTH_TOKEN",
  "META_ACCESS_TOKEN",
])
  delete process.env[key];
test("capacity uses peak occupancy, half-open boundaries and cleanup intervals", () => {
  assert.equal(
    capacityAvailable(
      0,
      120,
      [
        { start: 0, end: 30 },
        { start: 30, end: 60 },
        { start: 60, end: 120 },
      ],
      2,
    ),
    true,
  );
  assert.equal(
    capacityAvailable(
      0,
      120,
      [
        { start: 0, end: 90 },
        { start: 30, end: 90 },
        { start: 60, end: 120 },
      ],
      3,
    ),
    false,
  );
  assert.equal(capacityAvailable(90, 120, [{ start: 0, end: 90 }], 1), true);
  assert.equal(capacityAvailable(60, 120, [{ start: 0, end: 90 }], 1), false);
});
test("three concurrent bookings succeed, fourth fails, blocks still close the studio", async () => {
  try {
    const svc = (
      await query<{ id: string }>(
        "SELECT id FROM wl.services WHERE slug='exterior-detail'",
      )
    )[0];
    const d = new Date(Date.now() + 35 * 86400000);
    while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
    const date = d.toISOString().slice(0, 10);
    const make = () => ({
      request_key: randomUUID(),
      service_id: svc.id,
      first_name: "Capacity",
      last_name: "Test",
      email: "capacity@example.test",
      phone: "3125550101",
      make: "Toyota",
      model: "Camry",
      year: 2024,
      vehicle_type: "Sedan",
      date,
      start_minute: 480,
      terms: true,
      session_id: randomUUID(),
    });
    const results = await Promise.allSettled([
      createBooking(make(), true),
      createBooking(make(), true),
      createBooking(make(), true),
      createBooking(make(), true),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 3);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    assert.equal(
      (await availability(date, svc.id)).find((s) => s.minute === 480)
        ?.available,
      false,
    );
    await query(
      "UPDATE wl.bookings SET status='cancelled' WHERE booking_date=$1",
      [date],
    );
    assert.equal(
      (await availability(date, svc.id)).find((s) => s.minute === 480)
        ?.available,
      true,
    );
    await query(
      "INSERT INTO wl.blocks(id,booking_date,start_minute,end_minute) VALUES($1,$2,480,600)",
      [randomUUID(), date],
    );
    assert.equal(
      (await availability(date, svc.id)).find((s) => s.minute === 480)
        ?.available,
      false,
    );
  } finally {
    await closeDatabase();
  }
});
