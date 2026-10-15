import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { query, transaction, closeDatabase } from "../lib/platform/db";
import { createSquareInvoice } from "../lib/integrations/square-invoices";
import { upsertSquarePayment } from "../lib/integrations/square-reporting";
import { payrollSummary } from "../lib/platform/payroll";
import { adminAction } from "../lib/platform/admin";
process.env.PGLITE_PATH = "memory://detail-invoice";
delete process.env.DATABASE_URL;
process.env.ADMIN_EMAIL = "invoice-owner@example.test";
process.env.ADMIN_PASSWORD = "test-invoice-owner-password";
process.env.SQUARE_ENVIRONMENT = "production";
process.env.SQUARE_ACCESS_TOKEN = "test-token";
process.env.SQUARE_LOCATION_ID = "test-location";
test("one full Square invoice collects a deposit and balance, syncs tips/refunds without duplication, and preserves earned commissions", async () => {
  const fetchOriginal = globalThis.fetch;
  try {
    const customer = randomUUID(),
      vehicle = randomUUID(),
      booking = randomUUID(),
      employee = randomUUID();
    const service = (
      await query<{ id: string }>("SELECT id FROM wl.services LIMIT 1")
    )[0].id;
    await query(
      "INSERT INTO wl.customers(id,first_name,last_name,email,phone) VALUES($1,'Test','Invoice','invoice@example.test','+13125550199')",
      [customer],
    );
    await query(
      "INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Test','Car',2025,'Car')",
      [vehicle, customer],
    );
    await query(
      "INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,price_cents) VALUES($1,$2,'hash','INV-TEST',$3,$4,$5,'Full detail','{}','2026-10-20',600,120,20000)",
      [booking, randomUUID(), customer, vehicle, service],
    );
    const requests: Array<{ path: string; body: any }> = [];
    globalThis.fetch = async (input, init) => {
      const path = new URL(String(input)).pathname,
        body = init?.body ? JSON.parse(String(init.body)) : {};
      requests.push({ path, body });
      if (path === "/v2/customers")
        return Response.json({ customer: { id: "sq-customer" } });
      if (path === "/v2/orders")
        return Response.json({ order: { id: "sq-order" } });
      if (path === "/v2/invoices")
        return Response.json({
          invoice: {
            id: "sq-invoice",
            order_id: "sq-order",
            status: "DRAFT",
            version: 0,
          },
        });
      if (path === "/v2/invoices/sq-invoice/publish")
        return Response.json({
          invoice: {
            id: "sq-invoice",
            order_id: "sq-order",
            status: "UNPAID",
            version: 1,
            public_url: "https://squareup.com/pay-invoice/test",
          },
        });
      throw new Error("Unexpected Square call " + path);
    };
    assert.match((await createSquareInvoice(booking)).url, /pay-invoice/);
    assert.equal(
      requests.find((r) => r.path === "/v2/orders")!.body.order.line_items[0]
        .base_price_money.amount,
      20000,
    );
    const invoice = requests.find((r) => r.path === "/v2/invoices")!.body
      .invoice;
    assert.equal(
      invoice.payment_requests[0].fixed_amount_requested_money.amount,
      10000,
    );
    assert.equal(invoice.payment_requests[1].request_type, "BALANCE");
    assert.equal(invoice.payment_requests[1].tipping_enabled, true);
    assert.equal(invoice.delivery_method, "SHARE_MANUALLY");
    await createSquareInvoice(booking);
    assert.equal(requests.length, 4, "repeated click reuses invoice");
    const evidence = (id: string, principal: number, tip = 0, refund = 0) => ({
      id,
      order_id: "sq-order",
      location_id: "test-location",
      status: "COMPLETED",
      amount_money: { amount: principal, currency: "USD" },
      tip_money: { amount: tip, currency: "USD" },
      total_money: { amount: principal + tip, currency: "USD" },
      refunded_money: { amount: refund, currency: "USD" },
      created_at: "2026-10-20T12:00:00Z",
      updated_at: refund ? "2026-10-20T15:00:00Z" : "2026-10-20T13:00:00Z",
    });
    await transaction((q) =>
      upsertSquarePayment(q, evidence("deposit", 10000), "production"),
    );
    assert.equal(
      (
        await query<{ status: string }>(
          "SELECT status FROM wl.bookings WHERE id=$1",
          [booking],
        )
      )[0].status,
      "confirmed",
    );
    await transaction((q) =>
      upsertSquarePayment(q, evidence("final", 10000, 3000), "production"),
    );
    await transaction((q) =>
      upsertSquarePayment(q, evidence("final", 10000, 3000), "production"),
    );
    assert.equal(
      (
        await query<{ count: number }>(
          "SELECT count(*)::int count FROM wl.payments WHERE booking_id=$1",
          [booking],
        )
      )[0].count,
      2,
    );
    assert.equal(
      Number(
        (
          await query<{ total: number }>(
            "SELECT SUM(amount_cents-tip_cents-refunded_cents)::int total FROM wl.revenue_payments WHERE booking_id=$1",
            [booking],
          )
        )[0].total,
      ),
      20000,
    );
    assert.equal(
      Number(
        (
          await query<{ tip_cents: number }>(
            "SELECT tip_cents FROM wl.bookings WHERE id=$1",
            [booking],
          )
        )[0].tip_cents,
      ),
      3000,
    );
    await transaction((q) =>
      upsertSquarePayment(q, evidence("sandbox-only", 50000, 5000), "sandbox"),
    );
    assert.equal(
      Number(
        (
          await query<{ tip_cents: number }>(
            "SELECT tip_cents FROM wl.bookings WHERE id=$1",
            [booking],
          )
        )[0].tip_cents,
      ),
      3000,
    );
    await query(
      "INSERT INTO wl.employees(id,name,position,compensation_model,default_commission_bps,active) VALUES($1,'Test detailer','Detailer','commission',3000,true)",
      [employee],
    );
    await query(
      "INSERT INTO wl.employee_job_assignments(id,booking_id,employee_id,pool_share_bps,tip_override_cents) VALUES($1,$2,$3,10000,3000)",
      [randomUUID(), booking, employee],
    );
    const owner = (
      await query<{ id: string }>(
        "SELECT id FROM wl.users WHERE role='owner' LIMIT 1",
      )
    )[0];
    const session = {
      id: "test-session",
      user_id: owner.id,
      name: "Owner",
      email: "owner@example.test",
      role: "owner" as const,
    };
    await adminAction(
      "record_job_tip",
      { booking_id: booking, tip_cents: 500 },
      session,
    );
    assert.equal(
      Number(
        (
          await query<{ tip_cents: number }>(
            "SELECT tip_cents FROM wl.bookings WHERE id=$1",
            [booking],
          )
        )[0].tip_cents,
      ),
      3500,
    );
    assert.equal(
      (
        await query<{ tip_override_cents: number | null }>(
          "SELECT tip_override_cents FROM wl.employee_job_assignments WHERE booking_id=$1",
          [booking],
        )
      )[0].tip_override_cents,
      null,
    );
    await adminAction(
      "save_job_assignments",
      {
        booking_id: booking,
        assignments: [
          {
            employee_id: employee,
            pool_share_bps: 10000,
            tip_override_cents: 3500,
          },
        ],
      },
      session,
    );
    await query("UPDATE wl.bookings SET status='completed' WHERE id=$1", [
      booking,
    ]);
    await adminAction(
      "save_employee_compensation",
      {
        employee_id: employee,
        compensation_model: "commission",
        hourly_rate_cents: 0,
        default_commission_bps: 4000,
        flat_job_pay_cents: 0,
        preserve_completed: true,
      },
      session,
    );
    let earned = (await payrollSummary("2026-10-20", "2026-10-20")).find(
      (r) => r.id === employee,
    )!;
    assert.equal(
      Number(earned.commission_cents),
      6000,
      "past commission stays at 30%",
    );
    assert.equal(Number(earned.tips_cents), 3500);
    await transaction((q) =>
      upsertSquarePayment(
        q,
        evidence("final", 10000, 3000, 13000),
        "production",
      ),
    );
    earned = (await payrollSummary("2026-10-20", "2026-10-20")).find(
      (r) => r.id === employee,
    )!;
    assert.equal(
      Number(earned.tips_cents),
      500,
      "refunded Square tip removed; cash tip remains",
    );
    assert.equal(
      (
        await query<{ status: string }>(
          "SELECT status FROM wl.square_invoices WHERE booking_id=$1",
          [booking],
        )
      )[0].status,
      "PARTIALLY_PAID",
    );
  } finally {
    globalThis.fetch = fetchOriginal;
    await closeDatabase();
  }
});
