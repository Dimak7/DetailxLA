import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createBooking, bookingById, updateBooking } from "../lib/platform/bookings";
import { adminAction, adminData } from "../lib/platform/admin";
import { bookingReceipt } from "../lib/platform/receipts";
import { createCheckout } from "../lib/integrations/payments";
import { createSquareInvoice } from "../lib/integrations/square-invoices";
import { closeDatabase, query } from "../lib/platform/db";
import type { Service, Session } from "../lib/platform/types";

process.env.PGLITE_PATH = "memory://quoted-upgrades";
Object.assign(process.env, {
  NODE_ENV: "test", ADMIN_EMAIL: "upgrade-owner@example.test", ADMIN_PASSWORD: "test-only-upgrade-password-long",
  SQUARE_ACCESS_TOKEN: "test-only-token", SQUARE_LOCATION_ID: "test-only-location",
  SQUARE_WEBHOOK_SIGNATURE_KEY: "test-only-signature", SQUARE_ENVIRONMENT: "production",
});
for (const key of ["DATABASE_URL", "RAILWAY_ENVIRONMENT", "RESEND_API_KEY", "EMAIL_PROVIDER_API_KEY", "TELEGRAM_BOT_TOKEN", "TWILIO_AUTH_TOKEN", "SMS_PROVIDER_AUTH_TOKEN", "META_ACCESS_TOKEN"])
  delete process.env[key];

test("quoted upgrades stay unpriced through checkout, receipts, discounts and manager edits", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected external request"); });
  try {
    const services = await query<Service>("SELECT * FROM wl.services");
    const full = services.find((item) => item.slug === "full-detail")!;
    const headlight = services.find((item) => item.slug === "headlight-restoration")!;
    assert.equal(headlight.price_cents, 15000);
    assert.equal(headlight.suv_extra_cents, 0);
    assert.equal(headlight.truck_extra_cents, 0);
    assert.equal(headlight.pricing_mode, "fixed");
    assert.match(headlight.description, /both headlights/i);
    const user = (await query<{ id: string }>("SELECT id FROM wl.users WHERE email=$1", [process.env.ADMIN_EMAIL]))[0];
    const owner: Session = { id: randomUUID(), user_id: user.id, name: "Owner", email: process.env.ADMIN_EMAIL!, role: "owner" };
    const day = new Date(Date.now() + 14 * 86_400_000);
    while (day.getUTCDay() === 0) day.setUTCDate(day.getUTCDate() + 1);
    const input = {
      request_key: randomUUID(), services: [{ service_id: full.id, addons: ["ozone", "tar-removal", "iron-removal", "engine-bay"] }],
      session_id: randomUUID(), first_name: "Upgrade", last_name: "Test", email: "upgrade@example.test", phone: "+13125550123",
      make: "Test", model: "Car", year: 2026, vehicle_type: "SUV", date: day.toISOString().slice(0, 10), start_minute: 480, terms: true,
    };
    const { booking } = await createBooking(input);
    assert.equal((await createBooking(input)).booking.id, booking.id);
    assert.equal(booking.price_cents, null);
    assert.equal(booking.deposit_cents, 0);
    assert.equal(booking.service_snapshot.requires_quote, true);
    assert.equal(booking.service_snapshot.selected_services?.[0].total_cents, null);
    let receipt = (await bookingReceipt(booking.id))!;
    const quoteNames = ["Ozone Odor Treatment", "Tar Removal", "Iron Removal"];
    assert.equal(receipt.lineItems?.filter((item) => item.totalCents === null).length, 3);
    for (const name of quoteNames) assert.equal(receipt.lineItems?.find((item) => item.name === name)?.totalCents, null);
    assert.equal(receipt.lineItems?.find((item) => item.name === "Engine Bay")?.totalCents, 6000);
    await assert.rejects(createCheckout(booking.id), /quote must be agreed/i);
    await assert.rejects(updateBooking(booking.id, { status: "completed" }, user.id), /agree the final price/i);
    assert.equal((await bookingById(booking.id)).status, "new");
    await assert.rejects(createSquareInvoice(booking.id), /positive service price/i);
    await assert.rejects(updateBooking(booking.id, { price_cents: 80000, status: "confirmed" }, user.id), /each quoted upgrade/i);
    await adminAction("save_booking_discount", { booking_id: booking.id, kind: "fixed", value: 1000, reason: "Agreed discount" }, owner);
    assert.equal((await bookingById(booking.id)).price_cents, null);
    const dashboard = await adminData("bookings", new URLSearchParams({ search: booking.reference }), owner);
    assert.equal((dashboard.rows as Array<{ line_items: Array<{ quote_pending: boolean }> }>)[0].line_items.filter((item) => item.quote_pending).length, 3);
    const lines = await query<{ id: string; service_id: string; name: string }>("SELECT id,service_id,name FROM wl.booking_line_items WHERE booking_id=$1 AND quote_pending ORDER BY name", [booking.id]);
    for (const [index, line] of lines.entries()) {
      await adminAction("save_booking_line_item", { ...line, booking_id: booking.id, kind: "upsell", quantity: 1, unit_price_cents: 5000 }, owner);
      assert.equal((await bookingById(booking.id)).price_cents, null, "Pricing a line does not approve the appointment total");
      receipt = (await bookingReceipt(booking.id))!;
      assert.equal(receipt.lineItems?.find((item) => item.id === line.id)?.totalCents, 5000);
      assert.equal(receipt.lineItems?.filter((item) => item.totalCents === null).length, 2 - index);
      if (index < 2) await assert.rejects(updateBooking(booking.id, { price_cents: 80000 }, user.id), /each quoted upgrade/i);
    }
    const snapshot = (await bookingById(booking.id)).service_snapshot.selected_services![0];
    assert.ok(snapshot.selected_addons?.every((addon) => addon.priceCents !== null));
    await assert.rejects(updateBooking(booking.id, { status: "completed" }, user.id), /agree the final price/i);
    const total = snapshot.base_cents! + 6000 + 15000 - 1000;
    await updateBooking(booking.id, { price_cents: total, status: "completed" }, user.id);
    receipt = (await bookingReceipt(booking.id))!;
    assert.equal(receipt.priceCents, total);
    assert.ok(receipt.lineItems?.every((item) => item.totalCents !== null));
    const tariff = lines.find((line) => line.name === "Tar Removal")!;
    await adminAction("save_booking_line_item", { ...tariff, booking_id: booking.id, kind: "upsell", quantity: 1, unit_price_cents: 8000 }, owner);
    const repriced = await bookingById(booking.id);
    assert.equal(repriced.price_cents, total + 3000, "A previously quoted upgrade remains editable after the total is agreed");
    const repricedService = repriced.service_snapshot.selected_services![0];
    assert.equal(repricedService.selected_addons?.find((addon) => addon.line_item_id === tariff.id)?.priceCents, 8000);
    assert.equal(repricedService.total_cents, snapshot.total_cents! + 3000);
    receipt = (await bookingReceipt(booking.id))!;
    assert.equal(receipt.lineItems?.find((item) => item.id === tariff.id)?.totalCents, 8000);
    assert.equal(receipt.priceCents, total + 3000);
    assert.equal((await query("SELECT id FROM wl.payments WHERE booking_id=$1", [booking.id])).length, 0);
  } finally {
    await closeDatabase();
  }
});
