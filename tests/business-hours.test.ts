import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { query, closeDatabase } from "../lib/platform/db";
import { availability, createBooking, updateBooking } from "../lib/platform/bookings";
import { businessHoursForDay, openingHoursSpecification } from "../lib/platform/business-hours";
import { schema } from "../lib/platform/schema";
import { defaultSettings } from "../lib/platform/seed";
import { settings, saveSettings, settingsSchema, publicSettings } from "../lib/platform/settings";
import type { Service } from "../lib/platform/types";

process.env.PGLITE_PATH = "memory://";
delete process.env.DATABASE_URL;
process.env.ADMIN_SESSION_SECRET = "test-only-hours-session-secret-32-characters";

function futureDay(weekday: number, offset = 14) {
  const date = new Date(Date.now() + offset * 86400000);
  while (date.getUTCDay() !== weekday) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

test("Sunday hours govern availability, new bookings and rescheduling", async () => {
  try {
    const business = await settings();
    assert.equal(business.hours_label, "Monday-Saturday, 8:00 AM-8:00 PM; Sunday, 8:00 AM-5:00 PM");
    const specifications = openingHoursSpecification(business);
    assert.equal(specifications.length, 7);
    assert.deepEqual(specifications.find((hours) => hours.dayOfWeek === "Sunday"), {
      "@type": "OpeningHoursSpecification", dayOfWeek: "Sunday", opens: "08:00", closes: "17:00",
    });
    assert.equal(specifications.find((hours) => hours.dayOfWeek === "Saturday")?.closes, "20:00");

    const service = (await query<Service>("SELECT * FROM wl.services WHERE slug='exterior-detail'"))[0];
    assert.equal(service.duration_minutes, 120);
    const sunday = futureDay(0), monday = futureDay(1);
    const sundaySlots = await availability(sunday, service.id);
    assert.equal(sundaySlots[0]?.minute, 480);
    assert.equal(sundaySlots.at(-1)?.minute, 900);
    assert.ok(sundaySlots.every((slot) => slot.minute + service.duration_minutes <= 1020));
    assert.equal((await availability(monday, service.id)).at(-1)?.minute, 1080);

    const input = (date: string, start_minute: number) => ({
      request_key: randomUUID(), service_id: service.id,
      first_name: "Hours", last_name: "Customer", email: "hours@example.test", phone: "+13125550123",
      make: "Test", model: "Vehicle", year: 2025, vehicle_type: "Sedan",
      date, start_minute, terms: true, session_id: randomUUID(),
    });
    await assert.rejects(() => createBooking(input(sunday, 450)), /available appointment time/);
    await assert.rejects(() => createBooking(input(sunday, 930)), /available appointment time/);
    const sundayBooking = await createBooking(input(sunday, 900));
    assert.equal(sundayBooking.booking.start_minute + sundayBooking.booking.duration_minutes, 1020);
    const mondayBooking = await createBooking(input(monday, 1080));
    assert.equal(mondayBooking.booking.start_minute + mondayBooking.booking.duration_minutes, 1200);
    await assert.rejects(
      () => updateBooking(mondayBooking.booking.id, { date: futureDay(0, 28), start_minute: 1080 }, randomUUID()),
      /available appointment time/,
    );

    await saveSettings({ ...business, day_hours: [{ weekday: 0, open_time: "09:00", close_time: "16:00" }] });
    const changedSunday = await availability(futureDay(0, 28), service.id);
    assert.equal(changedSunday[0]?.minute, 540);
    assert.equal(changedSunday.at(-1)?.minute, 840);
    await saveSettings({ ...business, days: [1, 2, 3, 4, 5, 6] });
    assert.deepEqual(await availability(futureDay(0, 28), service.id), []);
    await assert.rejects(() => createBooking(input(futureDay(0, 28), 480)), /available appointment time/);

    // Missing overrides on older custom settings must keep their original Sunday hours.
    const { day_hours: _overrides, ...legacyBusiness } = business;
    await query("UPDATE wl.settings SET value=$1::jsonb WHERE key='business'", [JSON.stringify({
      ...legacyBusiness, open_time: "10:00", close_time: "18:00", hours_label: "Every day, 10 AM-6 PM",
    })]);
    const legacy = await settings();
    assert.deepEqual(legacy.day_hours, []);
    assert.deepEqual(businessHoursForDay(legacy, 0), { open_time: "10:00", close_time: "18:00" });
    assert.equal((await availability(futureDay(0, 28), service.id)).at(-1)?.minute, 960);
  } finally {
    await closeDatabase();
  }
});

test("business hours reject invalid and duplicate weekday overrides", () => {
  assert.equal(settingsSchema.safeParse(defaultSettings).success, true);
  for (const day_hours of [
    [{ weekday: 0, open_time: "17:00", close_time: "08:00" }],
    [{ weekday: 0, open_time: "08:00", close_time: "08:00" }],
    [{ weekday: 0, open_time: "08:00", close_time: "25:00" }],
    [{ weekday: 0, open_time: "08:00", close_time: "17:00" }, { weekday: 0, open_time: "08:00", close_time: "16:00" }],
  ]) {
    assert.equal(settingsSchema.safeParse({ ...defaultSettings, day_hours }).success, false);
  }
});

test("public business settings omit private notification routing", () => {
  const business = { ...defaultSettings, email_from: "private@example.test", telegram_chat_id: "private-chat", sms_from: "+13125550100" };
  const visible = publicSettings(business);
  assert.equal(visible.email_from, "");
  assert.equal(visible.telegram_chat_id, "");
  assert.equal(visible.sms_from, "");
  assert.equal(visible.email, business.email);
  assert.equal(visible.hours_label, business.hours_label);
  assert.deepEqual(visible.day_hours, business.day_hours);
  assert.equal(business.telegram_chat_id, "private-chat");
});

test("Sunday migration upgrades only the former default and runs once", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(schema.slice(0, schema.indexOf("-- Add Sunday only to the former default schedule")));
    const { day_hours: _overrides, ...legacyBusiness } = defaultSettings;
    const oldDefault = {
      ...legacyBusiness, days: [1, 2, 3, 4, 5, 6], hours_label: "Monday-Saturday, 8:00 AM-8:00 PM",
      address: "Custom address kept", phone: "+13125550100",
    };
    await db.query("INSERT INTO wl.settings(key,value) VALUES('business',$1::jsonb)", [JSON.stringify(oldDefault)]);
    await db.exec(schema);
    const upgraded = (await db.query<{ value: typeof defaultSettings }>("SELECT value FROM wl.settings WHERE key='business'")).rows[0].value;
    assert.deepEqual(upgraded.days, defaultSettings.days);
    assert.deepEqual(upgraded.day_hours, defaultSettings.day_hours);
    assert.equal(upgraded.hours_label, defaultSettings.hours_label);
    assert.equal(upgraded.address, oldDefault.address);
    assert.equal(upgraded.phone, oldDefault.phone);

    const customizedAfterMigration = { ...upgraded, day_hours: [{ weekday: 0, open_time: "09:00", close_time: "16:00" }] };
    await db.query("UPDATE wl.settings SET value=$1::jsonb WHERE key='business'", [JSON.stringify(customizedAfterMigration)]);
    await db.exec(schema);
    assert.deepEqual((await db.query<{ value: unknown }>("SELECT value FROM wl.settings WHERE key='business'")).rows[0].value, customizedAfterMigration);

    for (const custom of [
      { ...oldDefault, open_time: "09:00" },
      { ...oldDefault, close_time: "18:00" },
      { ...oldDefault, days: [1, 2, 3, 4, 5] },
      { ...oldDefault, days: [0, 1, 2, 3, 4, 5, 6] },
      { ...oldDefault, hours_label: "Custom public hours" },
      { ...oldDefault, day_hours: [{ weekday: 6, open_time: "10:00", close_time: "18:00" }] },
    ]) {
      await db.query("DELETE FROM wl.migrations WHERE version=4");
      await db.query("UPDATE wl.settings SET value=$1::jsonb WHERE key='business'", [JSON.stringify(custom)]);
      await db.exec(schema);
      assert.deepEqual((await db.query<{ value: unknown }>("SELECT value FROM wl.settings WHERE key='business'")).rows[0].value, custom);
    }
  } finally {
    await db.close();
  }
});
