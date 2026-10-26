import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createBooking, availability } from "../lib/platform/bookings";
import { closeDatabase, query } from "../lib/platform/db";
import { dateToday, type Service } from "../lib/platform/types";
import { hash, passwordHash } from "../lib/platform/auth";
import { GET as adminAvailability } from "../app/api/admin/booking-availability/route";
import { GET as publicAvailability } from "../app/api/availability/route";

Object.assign(process.env, { NODE_ENV: "test", PGLITE_PATH: "memory://admin-walkin-booking", BOOKING_DEPOSIT_PERCENT: "50" });
for (const key of ["DATABASE_URL", "RAILWAY_ENVIRONMENT", "ADMIN_EMAIL", "ADMIN_PASSWORD", "SQUARE_ACCESS_TOKEN", "STRIPE_SECRET_KEY", "RESEND_API_KEY", "EMAIL_PROVIDER_API_KEY", "TELEGRAM_BOT_TOKEN", "TWILIO_AUTH_TOKEN", "META_ACCESS_TOKEN"])
  delete process.env[key];
function input(service: Service, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { request_key: randomUUID(), service_id: service.id, session_id: randomUUID(), first_name: "Walk-in", last_name: "Customer", email: `${randomUUID()}@example.test`, phone: "+13125550123", make: "Test", model: "Car", year: 2026, vehicle_type: "Sedan", date: dateToday(), start_minute: 0, terms: true, ...overrides };
}
async function cookie(role: string) {
  const id = randomUUID(), token = randomBytes(32).toString("hex");
  await query("INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,'Test user',$2,$3,$4)", [id, `${id}@example.test`, passwordHash("Long-test-only-password"), role]);
  await query("INSERT INTO wl.sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')", [hash(token), id]);
  return `wl_session=${token}`;
}
async function openSchedule() {
  await query("UPDATE wl.settings SET value=value || $1::jsonb WHERE key='business'", [JSON.stringify({ days: [0,1,2,3,4,5,6], open_time: "00:00", close_time: "23:59", day_hours: [], buffer_minutes: 0, booking_capacity: 1 })]);
}

test("a walk-in agreed price is atomic, idempotent and separate from tips; public bookings cannot use it", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected external request"); });
  try {
    const service = (await query<Service>("SELECT * FROM wl.services WHERE slug='exterior-detail'"))[0];
    await openSchedule();
    const request = input(service, { admin_sale: { walk_in: true, duration_minutes: 30, prices: [{ service_id: service.id, name: "Hand wash", amount_cents: 2500 }] } });
    await assert.rejects(createBooking(request), /Invalid booking/);
    await assert.rejects(createBooking({ ...request, admin_sale: undefined }, true), /next year/);
    assert.equal((await query("SELECT id FROM wl.customers")).length, 0);
    const { booking } = await createBooking(request, true);
    assert.equal(booking.price_cents, 2500);
    assert.equal(booking.deposit_cents, 0);
    assert.equal((await query<{ tip_cents: number }>("SELECT tip_cents FROM wl.bookings WHERE id=$1", [booking.id]))[0].tip_cents, 0, "Tips are entered once when collecting payment");
    assert.equal(booking.duration_minutes, 30);
    assert.equal(booking.service_name, "Hand wash");
    assert.equal(booking.status, "confirmed");
    assert.equal(booking.service_snapshot.requires_quote, false);
    assert.equal(booking.service_snapshot.agreed_total_cents, 2500);
    const lines = await query<{ unit_price_cents: number; name: string; quote_pending: boolean }>("SELECT unit_price_cents,name,quote_pending FROM wl.booking_line_items WHERE booking_id=$1", [booking.id]);
    assert.deepEqual(lines, [{ unit_price_cents: 2500, name: "Hand wash", quote_pending: false }]);
    assert.equal((await createBooking(request, true)).booking.id, booking.id);
    await assert.rejects(createBooking({ ...request, admin_sale: { ...request.admin_sale as object, discount_cents: 1 } }, true), /already been used/);
    await assert.rejects(createBooking({ ...request, request_key: randomUUID() }, true), /no longer available/);
    const tomorrow = dateToday(new Date(Date.now() + 86400000));
    await assert.rejects(createBooking({ ...request, request_key: randomUUID(), date: tomorrow }, true), /Walk-in jobs must be booked for today/);
    await assert.rejects(createBooking({ ...request, request_key: randomUUID(), start_minute: 1 }, true), /available appointment/);
    assert.equal((await query("SELECT id FROM wl.bookings")).length, 1);
    assert.equal((await query("SELECT id FROM wl.payments")).length, 0, "Saving a job does not fabricate a payment");
  } finally { await closeDatabase(); }
});

test("admin sales preserve base and upsell prices, discount the full service total and persist the deposit", async () => {
  try {
    const service = (await query<Service>("SELECT * FROM wl.services WHERE slug='full-detail'"))[0];
    await openSchedule();
    const date = dateToday(new Date(Date.now() + 14 * 86400000));
    const request = input(service, {
      date, addons: ["ceramic-sealant"],
      admin_sale: { walk_in: false, duration_minutes: 60, prices: [{ service_id: service.id, amount_cents: 40000, addons: [{ addon_id: "ceramic-sealant", amount_cents: 15000 }] }], discount_cents: 5500 },
    });
    const { booking } = await createBooking(request, true);
    assert.equal(booking.price_cents, 49500);
    assert.equal(booking.deposit_cents, 24750);
    const lines = await query<{ kind: string; unit_price_cents: number }>("SELECT kind,unit_price_cents FROM wl.booking_line_items WHERE booking_id=$1 ORDER BY kind", [booking.id]);
    assert.deepEqual(lines, [{ kind: "base_service", unit_price_cents: 40000 }, { kind: "upsell", unit_price_cents: 15000 }]);
    assert.equal((await query<{ amount_cents: number }>("SELECT amount_cents FROM wl.booking_discounts WHERE booking_id=$1", [booking.id]))[0].amount_cents, 5500);
    assert.equal(booking.service_snapshot.selected_services?.[0].base_cents, 40000);
    assert.equal(booking.service_snapshot.selected_services?.[0].total_cents, 55000);
    assert.equal(booking.service_snapshot.agreed_total_cents, 49500);
    const before = (await query("SELECT id FROM wl.bookings")).length;
    const custom = (prices: unknown, discount_cents = 0) => input(service, { date, start_minute: 90, addons: ["ozone"], admin_sale: { walk_in: false, duration_minutes: 30, prices, discount_cents } });
    await assert.rejects(createBooking(custom([{ service_id: service.id, amount_cents: 2500 }]), true), /agreed price for Ozone/);
    await assert.rejects(createBooking(custom([{ service_id: randomUUID(), amount_cents: 2500 }]), true), /each selected service/);
    await assert.rejects(createBooking(custom([{ service_id: service.id, amount_cents: 2500 }, { service_id: service.id, amount_cents: 2500 }]), true), /exactly once/);
    await assert.rejects(createBooking(custom([{ service_id: service.id, amount_cents: 2500, addons: [{ addon_id: "made-up", amount_cents: 1000 }] }]), true), /selected upgrade/);
    await assert.rejects(createBooking(custom([{ service_id: service.id, amount_cents: 2500, addons: [{ addon_id: "ozone", amount_cents: 5000 }] }], 7501), true), /discount cannot exceed/);
    assert.equal((await query("SELECT id FROM wl.bookings")).length, before);
    const resolved = await createBooking(custom([{ service_id: service.id, amount_cents: 2500, addons: [{ addon_id: "ozone", amount_cents: 5000 }] }]), true);
    assert.equal(resolved.booking.price_cents, 7500);
    assert.equal(resolved.booking.service_snapshot.requires_quote, false);
    assert.equal((await query("SELECT id FROM wl.booking_line_items WHERE booking_id=$1 AND quote_pending", [resolved.booking.id])).length, 0);
  } finally { await closeDatabase(); }
});

test("walk-in availability is manager-only and keeps capacity, blocked time and shop hours", async () => {
  try {
    const service = (await query<Service>("SELECT * FROM wl.services WHERE slug='exterior-detail'"))[0];
    await openSchedule();
    const params = new URLSearchParams({ date: dateToday(), service_id: service.id, walk_in: "true", duration_minutes: "30" });
    const url = "https://example.test/api/admin/booking-availability?" + params;
    assert.equal((await adminAvailability(new Request(url))).status, 401);
    assert.equal((await adminAvailability(new Request(url, { headers: { Cookie: await cookie("staff") } }))).status, 403);
    const response = await adminAvailability(new Request(url, { headers: { Cookie: await cookie("manager") } }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal((await response.json()).slots.find((slot: { minute: number }) => slot.minute === 0).available, true);
    const publicResponse = await publicAvailability(new Request("https://example.test/api/availability?" + params));
    assert.equal((await publicResponse.json()).slots.find((slot: { minute: number }) => slot.minute === 0).available, false, "Public endpoint ignores admin-only options");
    await query("INSERT INTO wl.blocks(id,booking_date,start_minute,end_minute,reason) VALUES($1,$2,60,90,'Test block')", [randomUUID(), dateToday()]);
    assert.equal((await availability(dateToday(), service.id, undefined, { walk_in: true, duration_minutes: 30 })).find(slot => slot.minute === 60)?.available, false);
    await query("UPDATE wl.settings SET value=value || $1::jsonb WHERE key='business'", [JSON.stringify({ open_time: "08:00", close_time: "17:00" })]);
    const slots = await availability(dateToday(), service.id, undefined, { walk_in: true, duration_minutes: 30 });
    assert.equal(slots[0].minute, 480);
    assert.equal(slots.at(-1)?.minute, 990);
    await assert.rejects(createBooking(input(service, { admin_sale: { walk_in: true, duration_minutes: 30, prices: [{ service_id: service.id, amount_cents: 2500 }] } }), true), /available appointment/);
  } finally { await closeDatabase(); }
});
