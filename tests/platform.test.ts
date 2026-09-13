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
import {
  verifyStripeEvent,
  handleStripeEvent,
} from "../lib/integrations/payments";
import type { Service, Session } from "../lib/platform/types";
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
        await updateBooking(
          booking.booking.id,
          { assigned_to: staff.user_id },
          owner!.user_id,
        );
        const d = await adminData("bookings", new URLSearchParams(), staff);
        assert.ok("rows" in d);
        assert.equal(
          (d.rows as Record<string, unknown>[])[0].price_cents,
          undefined,
        );
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
