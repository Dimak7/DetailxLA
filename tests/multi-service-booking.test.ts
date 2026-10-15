import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createBooking, availability, updateBooking } from "../lib/platform/bookings";
import { closeDatabase, query } from "../lib/platform/db";
import { settings } from "../lib/platform/settings";
import { bookingCartSelection, type BookingServiceChoice } from "../lib/booking-options";
import type { Service } from "../lib/platform/types";
import { GET as availabilityRoute } from "../app/api/availability/route";

process.env.PGLITE_PATH = "memory://multi-service-booking";
Object.assign(process.env, {
  NODE_ENV: "test", ADMIN_EMAIL: "cart-owner@example.test", ADMIN_PASSWORD: "test-only-cart-password-long",
  SQUARE_ACCESS_TOKEN: "test-only-square-token", SQUARE_LOCATION_ID: "test-only-location",
  SQUARE_WEBHOOK_SIGNATURE_KEY: "test-only-signature", SQUARE_ENVIRONMENT: "sandbox", BOOKING_DEPOSIT_PERCENT: "50",
});
for (const name of ["DATABASE_URL", "RAILWAY_ENVIRONMENT", "STRIPE_SECRET_KEY", "RESEND_API_KEY", "EMAIL_PROVIDER_API_KEY", "TELEGRAM_BOT_TOKEN", "TWILIO_AUTH_TOKEN", "SMS_PROVIDER_AUTH_TOKEN", "META_ACCESS_TOKEN"])
  delete process.env[name];

function futureDay(offset = 14, sunday = false) {
  const day = new Date(Date.now() + offset * 86_400_000);
  while (sunday ? day.getUTCDay() !== 0 : day.getUTCDay() === 0) day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

test("multi-service bookings remain one correctly priced, scheduled and idempotent appointment", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected external request"); });
  try {
    const services = await query<Service>("SELECT * FROM wl.services ORDER BY sort_order");
    // These legacy overlap cases explicitly exercise a single-bay studio.
    await query("UPDATE wl.settings SET value=jsonb_set(value,'{booking_capacity}','1'::jsonb) WHERE key='business'");
    const full = services.find((service) => service.slug === "full-detail")!;
    const exterior = services.find((service) => service.slug === "exterior-detail")!;
    const interior = services.find((service) => service.slug === "interior-detail")!;
    const ceramic = services.find((service) => service.slug === "ceramic-coating")!;
    const correction = services.find((service) => service.slug === "paint-correction")!;
    const owner = (await query<{ id: string }>("SELECT id FROM wl.users WHERE email=$1", [process.env.ADMIN_EMAIL]))[0];
    const input = (choices: BookingServiceChoice[], date = futureDay()) => ({
      request_key: randomUUID(), services: choices, session_id: randomUUID(),
      first_name: "Cart", last_name: "Test", email: "cart@example.test", phone: "+13125550123",
      make: "Test", model: "Car", year: 2026, vehicle_type: "SUV", date, start_minute: 480, terms: true,
    });

    await t.test("known services sum size-specific prices and use one deposit and buffer", async () => {
      const choices = [{ service_id: exterior.id, addons: ["engine-bay"] }, { service_id: interior.id, addons: ["car-seat"] }];
      const request = input(choices);
      const expected = bookingCartSelection(services, "SUV", choices);
      const result = await createBooking(request);
      assert.equal(result.booking.price_cents, expected.totalCents);
      assert.equal(result.booking.deposit_cents, Math.round(expected.totalCents! / 2));
      assert.equal(result.booking.duration_minutes, exterior.duration_minutes + interior.duration_minutes);
      assert.equal(result.booking.buffer_minutes, (await settings()).buffer_minutes);
      assert.equal(result.booking.service_name, "Exterior Detail + Interior Detail");
      assert.deepEqual(result.booking.service_snapshot.selected_services?.map((item) => item.id), [exterior.id, interior.id]);
      const lines = await query<{ service_id: string; kind: string; unit_price_cents: number }>("SELECT service_id,kind,unit_price_cents FROM wl.booking_line_items WHERE booking_id=$1", [result.booking.id]);
      assert.equal(lines.length, 4);
      assert.equal(lines.filter((line) => line.service_id === exterior.id).length, 2);
      assert.equal(lines.reduce((sum, line) => sum + line.unit_price_cents, 0), expected.totalCents);
      assert.equal((await createBooking(request)).booking.id, result.booking.id);
      assert.equal((await query("SELECT id FROM wl.bookings WHERE request_key=$1", [request.request_key])).length, 1);
      await assert.rejects(createBooking({ ...request, services: [{ service_id: exterior.id }, { service_id: full.id }] }), /already been used/);
      const slots = await availability(request.date, [exterior.id, interior.id]);
      assert.equal(slots.find((slot) => slot.minute === 480)?.available, false);
      assert.equal(slots.find((slot) => slot.minute === 480 + expected.durationMinutes)?.available, false);
      assert.equal(slots.find((slot) => slot.minute === 480 + expected.durationMinutes + 30)?.available, true);
      await assert.rejects(updateBooking(result.booking.id, { start_minute: 1020 }, owner.id), /available appointment/);
      const revised = await updateBooking(result.booking.id, { price_cents: expected.totalCents! + 111 }, owner.id);
      assert.equal(revised.price_cents, expected.totalCents! + 111);
      const repriced = await query<{ service_id: string; unit_price_cents: number }>("SELECT service_id,unit_price_cents FROM wl.booking_line_items WHERE booking_id=$1", [result.booking.id]);
      assert.equal(repriced.reduce((sum, line) => sum + line.unit_price_cents, 0), revised.price_cents);
      assert.ok(repriced.every((line) => [exterior.id, interior.id].includes(line.service_id)));
    });

    await t.test("full detail and ceramic fit together, require consultation in either order and expose combined availability", async () => {
      for (const [index, pair] of [[full, ceramic], [ceramic, full]].entries()) {
        const request = input(pair.map((service) => ({ service_id: service.id })), futureDay(21 + index * 7));
        const result = await createBooking(request);
        assert.equal(result.booking.duration_minutes, 600);
        assert.equal(result.booking.deposit_cents, 0);
        assert.equal(result.booking.service_snapshot.requires_quote, true);
        assert.match(result.booking.service_name, /Full Detail/);
        assert.match(result.booking.service_name, /Ceramic Coating · 2 Year/);
      }
      const date = futureDay(42);
      const params = new URLSearchParams({ date });
      params.append("service_id", full.id);
      params.append("service_id", ceramic.id);
      const response = await availabilityRoute(new Request("https://example.test/api/availability?" + params));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.slots[0].minute, 480);
      assert.equal(body.slots.at(-1).minute, 600);
      await assert.rejects(availability(futureDay(14, true), [full.id, ceramic.id]), /opening hours/);
      await assert.rejects(createBooking(input([{ service_id: full.id }, { service_id: ceramic.id }], futureDay(14, true))), /opening hours/);
    });

    await t.test("unknown quote does not invent a total and can receive an agreed residual without altering the other service", async () => {
      const choices = [{ service_id: exterior.id }, { service_id: correction.id, service_package: "correction-level-3" }];
      const result = await createBooking(input(choices, futureDay(49)));
      assert.equal(result.booking.price_cents, null);
      assert.equal(result.booking.deposit_cents, 0);
      const fixedPrice = bookingCartSelection(services, "SUV", [{ service_id: exterior.id }]).totalCents!;
      const revised = await updateBooking(result.booking.id, { price_cents: fixedPrice + 120000 }, owner.id);
      const lines = await query<{ service_id: string; name: string; unit_price_cents: number }>("SELECT service_id,name,unit_price_cents FROM wl.booking_line_items WHERE booking_id=$1", [result.booking.id]);
      assert.equal(lines.find((line) => line.service_id === exterior.id)?.unit_price_cents, fixedPrice);
      assert.equal(lines.find((line) => line.service_id === correction.id)?.unit_price_cents, 120000);
      assert.equal(lines.find((line) => line.service_id === correction.id)?.name, "Paint Correction · Level 3");
      assert.equal(revised.service_snapshot.selected_services?.find((item) => item.id === correction.id)?.base_cents, 120000);
    });

    await t.test("invalid, duplicate, inactive or overlapping cart requests leave no partial records", async () => {
      const before = await query("SELECT id FROM wl.bookings");
      const customers = await query("SELECT id FROM wl.customers");
      await assert.rejects(createBooking(input([{ service_id: exterior.id }, { service_id: randomUUID() }], futureDay(56))), /no longer available/);
      await assert.rejects(createBooking(input([{ service_id: exterior.id }, { service_id: exterior.id }], futureDay(56))), /each service only once/);
      await query("UPDATE wl.services SET active=false WHERE id=$1", [interior.id]);
      await assert.rejects(createBooking(input([{ service_id: exterior.id }, { service_id: interior.id }], futureDay(56))), /no longer available/);
      await query("UPDATE wl.services SET active=true WHERE id=$1", [interior.id]);
      await assert.rejects(createBooking(input([{ service_id: exterior.id }, { service_id: full.id }], futureDay())), /no longer available/);
      await assert.rejects(createBooking(input([{ service_id: exterior.id, addons: ["trim-restoration"] }, { service_id: correction.id, addons: ["trim-restoration"] }], futureDay(56))), /only once/);
      assert.equal((await query("SELECT id FROM wl.bookings")).length, before.length);
      assert.equal((await query("SELECT id FROM wl.customers")).length, customers.length);
      const legacy = { ...input([], futureDay(63)), services: undefined, service_id: exterior.id };
      assert.equal((await createBooking(legacy)).booking.service_name, exterior.name);
    });
  } finally {
    await closeDatabase();
  }
});
