import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database, query, closeDatabase } from "../lib/platform/db";
import { report, reportRange } from "../lib/platform/reporting";
import { adminAction } from "../lib/platform/admin";
import { AppError } from "../lib/platform/auth";
import type { Session } from "../lib/platform/types";

// Each test file has its own process and this database never reaches production.
process.env.PGLITE_PATH = "memory://";
Object.assign(process.env, { NODE_ENV: "test" });
delete process.env.DATABASE_URL;
delete process.env.RAILWAY_ENVIRONMENT;

const day = "2026-07-01";
const paidAt = `${day}T18:00:00Z`;
const range = (from = day, to = from) => new URLSearchParams({ from, to });

test("report month presets retain Chicago calendar boundaries", () => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  const [year, month] = today.split("-").map(Number);
  assert.deepEqual(reportRange(new URLSearchParams({ range: "month" })), {
    start: `${today.slice(0, 7)}-01`, end: today,
  });
  assert.deepEqual(reportRange(new URLSearchParams({ range: "last_month" })), {
    start: new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10),
    end: new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10),
  });
});

async function resetFixtures() {
  for (const table of [
    "square_payments", "payments", "events", "bookings", "vehicles",
    "customers", "attributions", "ad_spend", "expenses",
  ]) {
    try { await query(`DELETE FROM wl.${table}`); }
    catch (cause) { throw new Error(`Fixture cleanup failed at ${table}`, { cause }); }
  }
}

async function bookingFixture(options: {
  paidAt?: string;
  price?: number;
  tip?: number;
  attributionId?: string;
} = {}) {
  const bookingId = randomUUID(), customerId = randomUUID(), vehicleId = randomUUID();
  const at = options.paidAt ?? paidAt;
  const [service] = await query<{ id: string }>("SELECT id FROM wl.services ORDER BY sort_order LIMIT 1");
  await query(
    `INSERT INTO wl.customers(id,first_name,last_name,email,phone,created_at)
     VALUES($1,'Square','Fixture',$2,'+13125550100',$3)`,
    [customerId, `${customerId}@example.test`, at],
  );
  await query(
    `INSERT INTO wl.vehicles(id,customer_id,make,model,year,type)
     VALUES($1,$2,'Test','Coupe',2025,'Sedan')`,
    [vehicleId, customerId],
  );
  await query(
    `INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,
      service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,
      status,price_cents,tip_cents,attribution_id,created_at,updated_at,completed_at)
     VALUES($1::uuid,$1::text,'fixture',$1::text,$2,$3,$4,'Fixture detail','{}',$5,600,60,
      'completed',$6,$7,$8,$9,$9,$9)`,
    [bookingId, customerId, vehicleId, service.id, at.slice(0, 10),
      options.price ?? 10000, options.tip ?? 0, options.attributionId ?? null, at],
  );
  return { bookingId, customerId };
}

async function localPayment(
  booking: Awaited<ReturnType<typeof bookingFixture>>,
  options: {
    amount?: number;
    refund?: number;
    fee?: number;
    provider?: "square" | "stripe" | "manual";
    status?: string;
    externalId?: string;
    metadata?: Record<string, unknown>;
    paidAt?: string;
  } = {},
) {
  const id = randomUUID();
  await query(
    `INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,refunded_cents,
      processor_fee_cents,provider,status,external_id,metadata,paid_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
    [id, booking.bookingId, booking.customerId, options.amount ?? 10000,
      options.refund ?? 0, options.fee ?? 0, options.provider ?? "square",
      options.status ?? "paid", options.externalId ?? "",
      JSON.stringify(options.metadata ?? { square_environment: "production" }),
      options.paidAt ?? paidAt],
  );
  return id;
}

async function squarePayment(options: {
  paymentId?: string;
  orderId?: string;
  environment?: "production" | "sandbox";
  status?: string;
  currency?: string;
  amount?: number;
  refund?: number;
  tip?: number;
  fee?: number;
  paidAt?: string;
} = {}) {
  const id = options.paymentId ?? randomUUID();
  await query(
    `INSERT INTO wl.square_payments(environment,payment_id,location_id,order_id,status,
      amount_cents,refunded_cents,tip_cents,processor_fee_cents,currency,source_type,
      payment_method,created_at,updated_at,paid_at)
     VALUES($1,$2,'fixture-location',$3,$4,$5,$6,$7,$8,$9,'CARD','Card',$10,$10,$10)`,
    [options.environment ?? "production", id, options.orderId ?? "",
      options.status ?? "COMPLETED", options.amount ?? 12000, options.refund ?? 0,
      options.tip ?? 0, options.fee ?? 0, options.currency ?? "USD", options.paidAt ?? paidAt],
  );
  return id;
}

test("Square revenue reports use the canonical production ledger", async (t) => {
  try {
    await database();
    // Keep PGlite work in one test context: nested node:test subtests trigger
    // a WASM function-signature failure on the current Node 24 host.
    const scenario = async (name: string, check: () => Promise<void>) => {
      await check();
      t.diagnostic(name);
    };
    await scenario("POS sales count in revenue and charts without creating booking metrics", async () => {
      await resetFixtures();
      await squarePayment({ amount: 12000, tip: 2000, fee: 350 });
      const result = await report(range());
      assert.equal(result.revenue, 12000);
      assert.equal(result.payments_collected, 12000);
      assert.equal(result.net_sales, 0);
      assert.equal(result.completed_jobs, 0);
      assert.equal(result.average_order, 0);
      assert.equal(result.revenue_per_customer, 0);
      assert.equal(result.processor_fees, 350);
      assert.equal(result.tips, 0, "booking tips remain separate from imported Square tips");
      assert.deepEqual(result.square, {
        gross: 12000, refunds: 0, net: 12000, fees: 350, tips: 2000,
        transaction_count: 1, unlinked_total: 12000, unlinked_transaction_count: 1,
      });
      assert.deepEqual(result.series, [{ day, revenue: 12000 }]);
      assert.deepEqual(result.financial_series, [{ day, revenue: 12000, expenses: 0, net_operating_profit: 12000 }]);
      assert.deepEqual(result.topServices, []);
      assert.equal(Number(result.bookings.total), 0);
      assert.equal(Number(result.customers.total), 0);
    });

    await scenario("a linked payment uses authoritative Square amounts once and POS does not inflate averages", async () => {
      await resetFixtures();
      const booking = await bookingFixture({ price: 10000, tip: 1500 });
      await localPayment(booking, { amount: 6000, externalId: "linked-payment" });
      await squarePayment({ paymentId: "linked-payment", amount: 12000, refund: 2000, tip: 2000, fee: 350 });
      await squarePayment({ amount: 5000, fee: 150 });
      const result = await report(range());
      assert.equal(result.revenue, 15000);
      assert.equal(result.refunds, 2000);
      assert.equal(result.processor_fees, 500);
      assert.equal(result.net_sales, 10000);
      assert.equal(result.outstanding, 0);
      assert.equal(result.tips, 1500);
      assert.equal(result.average_order, 10000);
      assert.equal(result.revenue_per_customer, 10000);
      assert.equal(result.square.transaction_count, 2);
      assert.equal(result.square.unlinked_total, 5000);
      assert.deepEqual(result.topServices, [{ service_name: "Fixture detail", revenue: 10000, bookings: 1 }]);
      const rows = await query<{ booking_id: string; customer_id: string; count: number }>(
        "SELECT booking_id,customer_id,count(*)::int count FROM wl.revenue_payments WHERE booking_id=$1 GROUP BY 1,2",
        [booking.bookingId],
      );
      assert.deepEqual(rows, [{ booking_id: booking.bookingId, customer_id: booking.customerId, count: 1 }]);
    });

    await scenario("partial and full refunds reduce net once while gross, tips and fees stay separate", async () => {
      await resetFixtures();
      const id = await squarePayment({ amount: 20000, tip: 1000, fee: 500 });
      await squarePayment({ amount: 9000, refund: 9000, tip: 400, fee: 250 });
      assert.equal((await report(range())).revenue, 20000);
      await query("UPDATE wl.square_payments SET refunded_cents=5000 WHERE payment_id=$1", [id]);
      const result = await report(range());
      assert.equal(result.revenue, 15000);
      assert.equal(result.refunds, 14000);
      assert.equal(result.processor_fees, 750);
      assert.deepEqual(result.square, {
        gross: 29000, refunds: 14000, net: 15000, fees: 750, tips: 1400,
        transaction_count: 2, unlinked_total: 15000, unlinked_transaction_count: 2,
      });
      assert.equal(result.net_operating_profit, 15000, "processor fees are disclosed, not silently subtracted twice");
      assert.deepEqual(result.series, [{ day, revenue: 15000 }]);
    });

    await scenario("pending, failed, sandbox, non-USD and unverified legacy Square payments are excluded", async () => {
      await resetFixtures();
      for (const status of ["PENDING", "APPROVED", "FAILED", "CANCELED"]) await squarePayment({ status });
      await squarePayment({ environment: "sandbox" });
      await squarePayment({ currency: "CAD" });
      const booking = await bookingFixture();
      await localPayment(booking, { metadata: {} });
      await localPayment(booking, { metadata: { square_environment: "sandbox" } });
      await localPayment(booking, { status: "pending" });
      await localPayment(booking, { status: "failed" });
      // A stale local paid row cannot revive a canonical non-completed payment.
      await localPayment(booking, { externalId: "canonical-pending" });
      await squarePayment({ paymentId: "canonical-pending", status: "PENDING" });
      const result = await report(range());
      assert.equal(result.revenue, 0);
      assert.equal(result.refunds, 0);
      assert.equal(result.processor_fees, 0);
      assert.equal(result.square.transaction_count, 0);
      assert.deepEqual(result.series, []);
      assert.equal(result.outstanding, 10000);
    });

    await scenario("reporting days use Chicago midnight in both standard and daylight time", async () => {
      for (const boundary of [
        { day: "2026-01-01", next: "2026-01-02", before: "2026-01-02T05:59:59Z", after: "2026-01-02T06:00:00Z" },
        { day: "2026-07-01", next: "2026-07-02", before: "2026-07-02T04:59:59Z", after: "2026-07-02T05:00:00Z" },
      ]) {
        await resetFixtures();
        await squarePayment({ amount: 1000, paidAt: boundary.before });
        await squarePayment({ amount: 2000, paidAt: boundary.after });
        const first = await report(range(boundary.day));
        const next = await report(range(boundary.next));
        assert.equal(first.revenue, 1000);
        assert.deepEqual(first.series, [{ day: boundary.day, revenue: 1000 }]);
        assert.equal(next.revenue, 2000);
        assert.deepEqual(next.series, [{ day: boundary.next, revenue: 2000 }]);
      }
    });

    await scenario("explicit production legacy Square remains a fallback alongside Stripe and manual payments", async () => {
      await resetFixtures();
      const booking = await bookingFixture({ price: 12000 });
      await localPayment(booking, { amount: 7500, refund: 500, fee: 225, status: "partially_refunded" });
      await localPayment(booking, { provider: "stripe", amount: 3000, fee: 90, metadata: {} });
      await localPayment(booking, { provider: "manual", amount: 2000, metadata: {} });
      const result = await report(range());
      assert.equal(result.revenue, 12000);
      assert.equal(result.refunds, 500);
      assert.equal(result.processor_fees, 315);
      assert.equal(result.average_order, 12000, "multiple payments still represent one paid booking");
      assert.equal(result.revenue_per_customer, 12000);
      assert.equal(result.outstanding, 0);
      assert.deepEqual(result.square, {
        gross: 7500, refunds: 500, net: 7000, fees: 225, tips: 0,
        transaction_count: 1, unlinked_total: 0, unlinked_transaction_count: 0,
      });
    });

    await scenario("order linkage keeps windows, campaigns, Google Ads and service totals consistent", async () => {
      await resetFixtures();
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
      const at = `${today}T18:00:00Z`;
      const tomorrow = new Date(`${today}T12:00:00Z`);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const attributionId = randomUUID();
      await query(
        "INSERT INTO wl.attributions(id,session_id,source,lead_stream,campaign,gclid,created_at) VALUES($1,$2,'Google Ads','Dima Leads','square-campaign','fixture-click',$3)",
        [attributionId, randomUUID(), at],
      );
      const booking = await bookingFixture({ paidAt: at, attributionId });
      await localPayment(booking, {
        amount: 4000, paidAt: at,
        metadata: { square_environment: "production", square_order_id: "linked-order" },
      });
      await squarePayment({ orderId: "linked-order", amount: 8000, refund: 1000, tip: 1000, fee: 200, paidAt: at });
      await localPayment(booking, { provider: "stripe", amount: 3000, fee: 90, paidAt: at });
      await squarePayment({ amount: 6000, fee: 150, paidAt: at });
      await squarePayment({ amount: 9999, paidAt: `${tomorrow.toISOString().slice(0, 10)}T18:00:00Z` });
      await query("INSERT INTO wl.ad_spend(id,channel,lead_stream,campaign,spend_date,amount_cents) VALUES($1,'Google Ads','Dima Leads','square-campaign',$2,2000)", [randomUUID(), today]);
      const result = await report(range(today));
      assert.equal(result.revenue, 16000);
      assert.equal(result.refunds, 1000);
      assert.equal(result.processor_fees, 440);
      assert.equal(result.average_order, 10000);
      assert.equal(result.revenue_per_customer, 10000);
      assert.equal(result.outstanding, 0);
      assert.deepEqual(result.windows, { today: 16000, week: 16000, month: 16000, year: 16000 });
      assert.deepEqual(result.series, [{ day: today, revenue: 16000 }]);
      assert.equal(result.square.net, 13000);
      assert.equal(result.square.transaction_count, 2);
      assert.equal(result.square.unlinked_total, 6000);
      assert.equal(result.google_ads.paid_revenue, 10000);
      assert.equal(result.google_ads.roas, 5);
      assert.equal(result.channels.find((row) => row.channel === "Google Ads")?.revenue, 10000);
      assert.equal(result.channels.find((row) => row.channel === "Google Ads")?.clients, 1);
      assert.equal(result.lead_streams.find((row) => row.lead_stream === "Dima Leads")?.revenue, 10000);
      assert.deepEqual(result.campaigns, [{ source: "Google Ads", lead_stream: "Dima Leads", campaign: "square-campaign", leads: 0, bookings: 1, clients: 1, revenue: 10000 }]);
      assert.deepEqual(result.topServices, [{ service_name: "Fixture detail", revenue: 10000, bookings: 1 }]);
    });

    await scenario("canonical bigint revenue is not narrowed to a 32-bit reporting total", async () => {
      await resetFixtures();
      await squarePayment({ amount: 3000000000, fee: 100000000 });
      const result = await report(range());
      assert.equal(result.revenue, 3000000000);
      assert.equal(result.square.gross, 3000000000);
      assert.equal(result.processor_fees, 100000000);
      assert.deepEqual(result.series, [{ day, revenue: 3000000000 }]);
    });

    await scenario("staff cannot start a Square sync or reach the network", async () => {
      const staff: Session = { id: "fixture-session", user_id: randomUUID(), name: "Staff", email: "staff@example.test", role: "staff" };
      const originalFetch = globalThis.fetch;
      let requests = 0;
      globalThis.fetch = async () => { requests++; throw new Error("Network must not be called"); };
      try {
        await assert.rejects(adminAction("sync_square_payments", {}, staff), (error: unknown) => error instanceof AppError && error.status === 403);
        assert.equal(requests, 0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  } finally {
    await closeDatabase();
  }
});
