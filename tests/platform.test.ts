import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { query, closeDatabase, transaction } from "../lib/platform/db";
import {
  createBooking,
  availability,
  updateBooking,
} from "../lib/platform/bookings";
import {
  addUser,
  login,
  sessionFromToken,
  createReset,
  resetPassword,
  verifyReceipt,
} from "../lib/platform/auth";
import { adminData, adminAction } from "../lib/platform/admin";
import { settings, saveSettings, secret } from "../lib/platform/settings";
import { queueCampaign, optOut } from "../lib/platform/campaigns";
import { report } from "../lib/platform/reporting";
import { processOutbox } from "../lib/platform/worker";
import { jobFinancials } from "../lib/platform/job-financials";
import {
  verifyStripeEvent,
  handleStripeEvent,
} from "../lib/integrations/payments";
import type { Service, Session } from "../lib/platform/types";
import { POST as employeeClock } from "../app/api/employee/clock/route";
process.env.PGLITE_PATH = "memory://";
delete process.env.DATABASE_URL;
process.env.ADMIN_EMAIL = "owner@example.test";
process.env.ADMIN_PASSWORD = "Test-only-long-password-4821";
process.env.ADMIN_SESSION_SECRET = "test-only-session-secret-32-characters";
process.env.SETTINGS_ENCRYPTION_KEY = "test-only-encryption-key-32-characters";
for (const key of [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "EMAIL_PROVIDER_API_KEY",
  "RESEND_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "SMS_PROVIDER_AUTH_TOKEN",
  "TWILIO_AUTH_TOKEN",
  "META_ACCESS_TOKEN",
])
  delete process.env[key];
test("Relational platform integration", async (t) => {
  try {
    const services = await query<Service>(
      "SELECT * FROM wl.services ORDER BY sort_order",
    );
    assert.equal(services.length, 8);
    const owner = await sessionFromToken(
      await login(
        process.env.ADMIN_EMAIL!,
        process.env.ADMIN_PASSWORD!,
        "test",
      ),
    );
    assert.ok(owner);
    let booking: Awaited<ReturnType<typeof createBooking>>;
    const date = new Date(Date.now() + 14 * 86400000);
    while (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
    const day = date.toISOString().slice(0, 10);
    const input = {
      request_key: randomUUID(),
      service_id: services[0].id,
      first_name: "Test",
      last_name: "Customer",
      email: "customer@example.test",
      phone: "+13125550123",
      make: "Test",
      model: "Vehicle",
      year: 2025,
      vehicle_type: "SUV",
      date: day,
      start_minute: 480,
      terms: true,
      session_id: randomUUID(),
      attribution: {
        source: "google",
        medium: "cpc",
        campaign: "test-only-campaign",
      },
      marketing_email: false,
      marketing_sms: false,
    };
    await t.test(
      "booking creates connected customer, vehicle, lead, attribution, events and outbox",
      async () => {
        booking = await createBooking(input);
        assert.equal(booking.booking.price_cents, 12000);
        assert.equal((await query("SELECT * FROM wl.customers")).length, 1);
        assert.equal((await query("SELECT * FROM wl.vehicles")).length, 1);
        assert.equal((await query("SELECT * FROM wl.leads")).length, 1);
        assert.equal(
          (
            await query<{ source: string }>(
              "SELECT source FROM wl.attributions",
            )
          )[0].source,
          "Google Ads",
        );
        assert.ok((await query("SELECT * FROM wl.messages")).length >= 5);
        assert.equal(
          (
            await query<{ marketing_sms: boolean }>(
              "SELECT marketing_sms FROM wl.customers",
            )
          )[0].marketing_sms,
          false,
        );
        assert.ok(await verifyReceipt(booking.booking.id, booking.token));
      },
    );
    await t.test("job upsells and discounts calculate an auditable booking total", async () => {
      await adminAction("save_booking_line_item", {
        booking_id: booking.booking.id,
        kind: "upsell",
        name: "Engine bay detail",
        quantity: 1,
        unit_price_cents: 4500,
      }, owner!);
      // The API deliberately ignores a client-provided dollar amount for a percentage discount.
      const result = await adminAction("save_booking_discount", {
        booking_id: booking.booking.id,
        kind: "percent",
        value: 2500,
        amount_cents: 1,
        reason: "Returning customer",
        code: "WELCOME25",
      }, owner!) as unknown as { amount_cents: number; netCents: number };
      assert.equal(result.amount_cents, 4125);
      assert.equal(result.netCents, 12375);
      const financials = await jobFinancials(booking.booking.id);
      assert.equal(financials?.base_service_cents, 12000);
      assert.equal(financials?.upsell_cents, 4500);
      assert.equal(financials?.discount_cents, 4125);
      assert.equal(financials?.net_service_cents, 12375);
      assert.equal((await query<{ price_cents: number }>("SELECT price_cents FROM wl.bookings WHERE id=$1", [booking.booking.id]))[0].price_cents, 12375);
    });
    await t.test(
      "idempotent retries and concurrent overlap protection",
      async () => {
        const retry = await createBooking(input);
        assert.equal(retry.booking.id, booking.booking.id);
        await assert.rejects(
          () => createBooking({ ...input, notes: "different" }),
          /already been used/,
        );
        const conflicts = await Promise.allSettled([
          createBooking({
            ...input,
            request_key: randomUUID(),
            start_minute: 510,
          }),
          createBooking({
            ...input,
            request_key: randomUUID(),
            start_minute: 540,
          }),
        ]);
        assert.ok(conflicts.every((x) => x.status === "rejected"));
        assert.equal((await query("SELECT * FROM wl.bookings")).length, 1);
        const slots = await availability(day, services[0].id);
        assert.equal(slots.find((s) => s.minute === 600)?.available, false);
        assert.equal(slots.find((s) => s.minute === 630)?.available, true);
      },
    );
    await t.test(
      "invalid dates and disabled services are rejected",
      async () => {
        await assert.rejects(
          () =>
            createBooking({
              ...input,
              request_key: randomUUID(),
              date: "2027-02-30",
            }),
          /valid date/,
        );
        await query("UPDATE wl.services SET active=false WHERE id=$1", [
          services[0].id,
        ]);
        await assert.rejects(
          () =>
            createBooking({
              ...input,
              request_key: randomUUID(),
              start_minute: 900,
            }),
          /available/,
        );
        await query("UPDATE wl.services SET active=true WHERE id=$1", [
          services[0].id,
        ]);
      },
    );
    await t.test(
      "staff permissions exclude finance and non-assigned bookings",
      async () => {
        await addUser({
          name: "Test Staff",
          email: "staff@example.test",
          password: "Test-staff-password-long",
          role: "staff",
        });
        const staff = (await sessionFromToken(
          await login(
            "staff@example.test",
            "Test-staff-password-long",
            "staff",
          ),
        ))!;
        await assert.rejects(
          () => adminData("dashboard", new URLSearchParams(), staff),
          /access/,
        );
        await assert.rejects(
          () => adminAction("save_settings", {}, staff),
          /cannot/,
        );
        await assert.rejects(
          () =>
            updateBooking(
              booking.booking.id,
              { status: "confirmed" },
              staff.user_id,
              true,
            ),
          /assigned/,
        );
        await assert.rejects(
          () => updateBooking(booking.booking.id, { assigned_to: staff.user_id }, owner!.user_id),
          /active detailer/,
        );
        const d = await adminData("bookings", new URLSearchParams(), staff);
        assert.ok("rows" in d);
        assert.equal((d.rows as Record<string, unknown>[]).length, 0);
      },
    );
    await t.test("all admin sections query real relational data", async () => {
      for (const section of [
        "dashboard",
        "bookings",
        "calendar",
        "customers",
        "leads",
        "services",
        "marketing",
        "messages",
        "reviews",
        "gallery",
        "analytics",
        "settings",
        "payments",
        "employees",
        "schedule",
      ])
        assert.ok(await adminData(section, new URLSearchParams(), owner!));
    });
    await t.test(
      "unpaid bookings never count as revenue; signed payments are authoritative",
      async () => {
        assert.equal((await report(new URLSearchParams())).revenue, 0);
        const id = randomUUID();
        await query(
          "INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents) VALUES($1,$2,$3,12000)",
          [id, booking.booking.id, booking.booking.customer_id],
        );
        process.env.STRIPE_SECRET_KEY = "sk_test_not_a_real_key";
        process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_not_real";
        const event = {
          id: "evt_test_platform",
          type: "checkout.session.completed",
          data: {
            object: {
              id: "cs_test_platform",
              metadata: { payment_id: id, booking_id: booking.booking.id },
              amount_total: 12000,
              currency: "usd",
              payment_status: "paid",
              payment_intent: "pi_test_platform",
            },
          },
        } as unknown as Stripe.Event;
        const body = JSON.stringify(event),
          signature = Stripe.webhooks.generateTestHeaderString({
            payload: body,
            secret: process.env.STRIPE_WEBHOOK_SECRET,
          });
        await assert.rejects(
          () => verifyStripeEvent(body, "invalid"),
          /signature/,
        );
        const verified = await verifyStripeEvent(body, signature);
        await handleStripeEvent(verified);
        await handleStripeEvent(verified);
        assert.equal((await report(new URLSearchParams())).revenue, 12000);
        assert.equal(
          (
            await query(
              "SELECT * FROM wl.events WHERE name='payment_completed'",
            )
          ).length,
          1,
        );
        await handleStripeEvent({
          id: "evt_test_refund",
          type: "charge.refunded",
          data: {
            object: {
              payment_intent: "pi_test_platform",
              amount_refunded: 2000,
            },
          },
        } as unknown as Stripe.Event);
        assert.equal((await report(new URLSearchParams())).revenue, 10000);
        delete process.env.STRIPE_SECRET_KEY;
        delete process.env.STRIPE_WEBHOOK_SECRET;
      },
    );
    await t.test(
      "marketing requires consent and STOP suppresses already queued SMS",
      async () => {
        const cid = booking.booking.customer_id,
          campaignId = randomUUID();
        await query(
          "INSERT INTO wl.campaigns(id,name,channel,audience,body) VALUES($1,'Test only','sms','all','Test')",
          [campaignId],
        );
        await queueCampaign(campaignId);
        assert.equal(
          (
            await query("SELECT * FROM wl.messages WHERE campaign_id=$1", [
              campaignId,
            ])
          ).length,
          0,
        );
        await query("UPDATE wl.customers SET marketing_sms=true WHERE id=$1", [
          cid,
        ]);
        const id = randomUUID();
        await query(
          "INSERT INTO wl.campaigns(id,name,channel,audience,body) VALUES($1,'Test consent','sms','all','Test')",
          [id],
        );
        await queueCampaign(id);
        assert.equal(
          (await query("SELECT * FROM wl.messages WHERE campaign_id=$1", [id]))
            .length,
          1,
        );
        await optOut("+13125550123");
        assert.equal(
          (
            await query<{ status: string }>(
              "SELECT status FROM wl.messages WHERE campaign_id=$1",
              [id],
            )
          )[0].status,
          "cancelled",
        );
      },
    );
    await t.test(
      "missing notifications are logged without undoing a reservation",
      async () => {
        await processOutbox(50);
        assert.equal((await query("SELECT * FROM wl.bookings")).length, 1);
        assert.ok(
          (await query("SELECT * FROM wl.messages WHERE status='skipped'"))
            .length > 0,
        );
      },
    );
    await t.test(
      "settings secrets are encrypted and never returned in settings",
      async () => {
        const b = await settings();
        await saveSettings(b, { telegram_token: "test-not-a-real-secret" });
        assert.equal(await secret("telegram_token"), "test-not-a-real-secret");
        assert.ok(
          !(
            await query<{ ciphertext: string }>(
              "SELECT ciphertext FROM wl.secrets WHERE key='telegram_token'",
            )
          )[0].ciphertext.includes("test-not-a-real-secret"),
        );
        assert.equal(
          ((await settings()) as unknown as Record<string, unknown>)
            .telegram_token,
          undefined,
        );
      },
    );
    await t.test("employee scheduling, self-service time clock, hours and payroll work end to end", async () => {
      const sunday = new Date();
      sunday.setUTCDate(sunday.getUTCDate() + ((7 - sunday.getUTCDay()) % 7));
      const week = sunday.toISOString().slice(0, 10);
      const availability = Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        available: true,
        start_minute: 480,
        end_minute: 1080,
      }));
      const created = await adminAction("save_employee", {
        name: "John Smith",
        email: "john.smith@example.test",
        phone: "+13125550124",
        password: "John-test-password-4821",
        position: "Detailer",
        hourly_rate_cents: 2500,
        max_weekly_minutes: 2400,
        hire_date: week,
        notes: "Test employee",
        active: true,
        availability,
      }, owner!);
      const employeeId = String((created as { id: string }).id);
      const johnToken = await login("john.smith@example.test", "John-test-password-4821", "john");
      const john = await sessionFromToken(johnToken);
      assert.ok(john);
      assert.equal((await query<{ user_id: string }>("SELECT user_id FROM wl.employees WHERE id=$1", [employeeId]))[0].user_id, john!.user_id);
      await updateBooking(booking.booking.id, { assigned_to: john!.user_id, assignment_override: true }, owner!.user_id);
      const assignedSchedule = await adminData("my_schedule", new URLSearchParams(), john!);
      assert.ok((assignedSchedule.appointments as unknown[]).length > 0);
      await updateBooking(booking.booking.id, { status: "in_progress" }, john!.user_id, true);
      await updateBooking(booking.booking.id, { status: "completed" }, john!.user_id, true);
      assert.equal((await query<{ status: string }>("SELECT status FROM wl.bookings WHERE id=$1", [booking.booking.id]))[0].status, "completed");
      await adminAction("generate_schedule", { week, start_minute: 540, end_minute: 1020 }, owner!);
      const draft = (await query<{ id: string; employee_id: string; shift_date: string; start_minute: number; end_minute: number; break_minutes: number; status: string }>("SELECT * FROM wl.employee_shifts WHERE employee_id=$1 AND shift_date=$2", [employeeId, week]))[0];
      assert.ok(draft);
      await adminAction("save_shift", { ...draft, notes: "Bring detailing kit" }, owner!);
      await adminAction("publish_schedule", { week }, owner!);
      assert.equal((await query<{ published: boolean }>("SELECT published FROM wl.employee_shifts WHERE id=$1", [draft.id]))[0].published, true);
      assert.equal((await query<{ status: string; error: string }>("SELECT status,error FROM wl.schedule_notifications WHERE employee_id=$1 AND week_start=$2", [employeeId, week]))[0].status, "skipped");
      const schedule = await adminData("my_schedule", new URLSearchParams(), john!);
      assert.ok((schedule.shifts as unknown[]).length > 0);
      const request = (action: string) => new Request("http://localhost/api/employee/clock", { method: "POST", headers: { origin: "http://localhost", cookie: "wl_session=" + johnToken, "content-type": "application/json" }, body: JSON.stringify({ action }) });
      assert.equal((await employeeClock(request("in"))).status, 200);
      await query("UPDATE wl.time_entries SET clock_in=now()-interval '2 hours' WHERE employee_id=$1 AND clock_out IS NULL", [employeeId]);
      assert.equal((await employeeClock(request("out"))).status, 200);
      const period = new URLSearchParams({ start: "2000-01-01", end: "2100-01-01" });
      const hours = await adminData("hours", period, owner!);
      assert.ok((hours.rows as Array<Record<string, unknown>>).some((entry) => entry.name === "John Smith" && Number(entry.worked_minutes) >= 119));
      const payroll = await adminData("payroll", period, owner!);
      assert.ok((payroll.rows as Array<Record<string, unknown>>).some((entry) => entry.name === "John Smith" && Number(entry.estimated_gross_cents) >= 4900));
    });
    await t.test("password reset is one use and revokes sessions", async () => {
      const token = await createReset("owner@example.test", "reset-test");
      assert.ok(token);
      await resetPassword(token, "new-test-password-more-than-12");
      await assert.rejects(
        () => resetPassword(token, "another-password-long"),
        /invalid or expired/,
      );
      assert.equal(
        (
          await query("SELECT * FROM wl.sessions WHERE user_id=$1", [
            owner!.user_id,
          ])
        ).length,
        0,
      );
    });
  } finally {
    await closeDatabase();
  }
});
