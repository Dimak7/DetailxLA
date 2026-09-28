import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database, query, closeDatabase } from "../lib/platform/db";
import { adminAction, adminData } from "../lib/platform/admin";
import { AppError } from "../lib/platform/auth";
import { dateToday, type Session } from "../lib/platform/types";

process.env.PGLITE_PATH = "memory://dashboard-data";
Object.assign(process.env, { NODE_ENV: "test" });
delete process.env.DATABASE_URL;
delete process.env.RAILWAY_ENVIRONMENT;

const badRequest = (error: unknown) => error instanceof AppError && error.status === 400;

test("dashboard data and pay-rule actions preserve their visible contracts", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Dashboard regressions must not call external APIs"); };
  try {
    await database();
    // One test context avoids the host's PGlite nested-subtest WASM issue.
    const scenario = async (name: string, run: () => Promise<void>) => {
      await run();
      t.diagnostic(name);
    };
    const ownerId = randomUUID(), customerId = randomUUID(), vehicleId = randomUUID();
    const owner: Session = { id: "fixture-session", user_id: ownerId, name: "Dashboard owner", email: "dashboard-owner@example.test", role: "owner" };
    await query("INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,$2,$3,'unused-fixture-hash','owner')", [ownerId, owner.name, owner.email]);
    await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone) VALUES($1,'Dashboard','Fixture',$2,'')", [customerId, `${customerId}@example.test`]);
    await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Test','Coupe',2025,'Sedan')", [vehicleId, customerId]);
    const services = await query<{ id: string }>("SELECT id FROM wl.services ORDER BY sort_order,id LIMIT 2");
    assert.equal(services.length, 2);
    const addBooking = async (date: string, status = "new", assignedTo: string | null = null) => {
      const id = randomUUID();
      await query(`INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,
        service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,status,price_cents,assigned_to)
        VALUES($1::uuid,$1::text,'fixture',$1::text,$2,$3,$4,'Fixture detail','{}',$5,600,60,$6,10000,$7)`,
      [id, customerId, vehicleId, services[0].id, date, status, assignedTo]);
      return id;
    };
    const today = dateToday();
    const relativeDay = (offset: number) => {
      const day = new Date(`${today}T12:00:00Z`);
      day.setUTCDate(day.getUTCDate() + offset);
      return day.toISOString().slice(0, 10);
    };

    await scenario("operations is an object and counts only active detailers and active unassigned jobs", async () => {
      for (const [position, active] of [["Detailer", true], [" DETAILER ", true], ["Detailer", false], ["Manager", true]] as const) {
        await query("INSERT INTO wl.employees(id,name,position,active) VALUES($1,'Operations fixture',$2,$3)", [randomUUID(), position, active]);
      }
      const expected = [
        await addBooking(today, "new"),
        await addBooking(relativeDay(1), "confirmed"),
        await addBooking(relativeDay(2), "in_progress"),
      ];
      await addBooking(relativeDay(-1), "new");
      await addBooking(today, "confirmed", ownerId);
      await addBooking(today, "completed");
      await addBooking(today, "cancelled");
      await addBooking(today, "no_show");
      await addBooking(relativeDay(1), "completed");
      await addBooking(relativeDay(1), "cancelled");
      await addBooking(relativeDay(1), "no_show");
      const data = await adminData("dashboard", new URLSearchParams({ from: today, to: today }), owner);
      assert.ok(data.operations && !Array.isArray(data.operations));
      assert.deepEqual(data.operations, { active_detailers: 2, today_jobs: 3, unassigned_jobs: 3 });
      assert.deepEqual(data.unassigned?.map((row) => row.id), expected);
    });

    await scenario("February 2026 calendar covers all 42 visible days through March 14", async () => {
      // Clear bookings from the relative-date scenario so this remains independent of today's month.
      await query("DELETE FROM wl.bookings");
      const first = await addBooking("2026-02-01");
      const middle = await addBooking("2026-02-28");
      const last = await addBooking("2026-03-14");
      await addBooking("2026-01-31");
      await addBooking("2026-03-15");
      const data = await adminData("calendar", new URLSearchParams({ date: "2026-02-20" }), owner);
      assert.ok("total" in data);
      assert.equal(data.total, 3);
      assert.deepEqual(data.rows?.map((row) => row.id), [last, middle, first]);
    });

    await scenario("malformed dashboard parameters return application 400 errors", async () => {
      const cases: Array<[string, Record<string, string>]> = [
        ...["0", "-1", "1.5", "NaN", "Infinity"].map((page): [string, Record<string, string>] => ["customers", { page }]),
        ["employees", { week: "2026-02-30" }],
        ["schedule", { week: "not-a-date" }],
        ["hours", { start: "2026-02-30", end: "2026-03-01" }],
        ["payroll", { start: "2026-03-02", end: "2026-03-01" }],
        ["performance", { start: "2026-02-01", end: "invalid" }],
        ["bookings", { date: "2026-13-01" }],
        ["calendar", { date: "2026-02-29" }],
        ["payments", { date: "invalid" }],
        ["customers", { id: "not-a-uuid" }],
        ["inventory", { id: "not-a-uuid" }],
        ...["0", "-1", "1.5", "NaN", "9007199254740991"].map((squarePage): [string, Record<string, string>] => ["payments", { squarePage }]),
        ["reports", { from: "2026-02-30", to: "2026-03-01" }],
        ["reports", { from: "2026-03-02", to: "2026-03-01" }],
      ];
      for (const [section, params] of cases) {
        await assert.rejects(adminData(section, new URLSearchParams(params), owner), badRequest, `${section}: ${JSON.stringify(params)}`);
      }
    });

    await scenario("customer lifetime spend includes refunds and production collections while excluding Square sandbox", async () => {
      const bookingId = await addBooking("2026-06-01", "completed");
      const payment = async (provider: string, amount: number, refund: number, environment?: string, externalId = "") => {
        await query(`INSERT INTO wl.payments(id,booking_id,customer_id,provider,amount_cents,refunded_cents,status,metadata,external_id,paid_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,'2026-06-01T18:00:00Z')`,
        [randomUUID(), bookingId, customerId, provider, amount, refund, refund ? "partially_refunded" : "paid",
          JSON.stringify(environment ? { square_environment: environment } : {}), externalId]);
      };
      await payment("manual", 10000, 2000);
      await payment("square", 5000, 1000, "production", "customer-production");
      await payment("square", 90000, 0, "sandbox", "customer-sandbox");
      await payment("square", 70000, 0);
      await query(`INSERT INTO wl.square_payments(environment,payment_id,status,amount_cents,refunded_cents,currency,paid_at)
        VALUES('production','customer-production','COMPLETED',5000,1000,'USD','2026-06-01T18:00:00Z'),
        ('sandbox','customer-sandbox','COMPLETED',90000,0,'USD','2026-06-01T18:00:00Z')`);
      const data = await adminData("customers", new URLSearchParams({ id: customerId }), owner);
      const customer = data.rows?.find((row) => row.id === customerId);
      assert.ok(customer);
      assert.equal(Number(customer.total_spent), 12000);
      assert.equal(data.profile?.customer.id, customerId);
      assert.equal((await query<{ count: number }>("SELECT count(*)::int count FROM wl.square_payments WHERE environment='sandbox'"))[0].count, 1);
    });

    await scenario("All services rules reuse their ID and guard duplicate scopes and commission limits", async () => {
      const employeeId = randomUUID();
      await query("INSERT INTO wl.employees(id,name,position) VALUES($1,'Rule fixture','Manager')", [employeeId]);
      const base = { employee_id: employeeId, service_id: null, rule_type: "commission_percent", value: 2000, active: true };
      const save = async (input: Record<string, unknown>) => adminAction("save_pay_rule", input, owner) as Promise<{ id: string }>;
      const created = await save(base);
      assert.deepEqual(await save({ ...base, id: created.id, value: 2500, active: false }), created);
      assert.deepEqual(await save({ ...base, value: 3000 }), created);
      assert.deepEqual(await query("SELECT id,service_id,value,active FROM wl.employee_pay_rules WHERE employee_id=$1", [employeeId]), [
        { id: created.id, service_id: null, value: 3000, active: true },
      ]);

      const specific = await save({ ...base, service_id: services[0].id, value: 4000 });
      const second = await save({ ...base, service_id: services[1].id, value: 5000 });
      const before = await query("SELECT * FROM wl.employee_pay_rules WHERE employee_id=$1 ORDER BY id", [employeeId]);
      await assert.rejects(save({ ...base, id: second.id, service_id: services[0].id }), (error: unknown) => badRequest(error) && /already exists/.test((error as Error).message));
      await assert.rejects(save({ ...base, id: created.id, service_id: services[0].id }), badRequest);
      assert.deepEqual(await query("SELECT * FROM wl.employee_pay_rules WHERE employee_id=$1 ORDER BY id", [employeeId]), before);
      assert.deepEqual(await save({ ...base, service_id: services[0].id, value: 4500 }), specific);

      assert.deepEqual(await save({ ...base, id: created.id, value: 10000 }), created);
      await assert.rejects(save({ ...base, id: created.id, value: 10001 }), badRequest);
      assert.equal((await query<{ value: number }>("SELECT value FROM wl.employee_pay_rules WHERE id=$1", [created.id]))[0].value, 10000);
      const flat = await save({ ...base, rule_type: "flat_job", value: 10001 });
      assert.notEqual(flat.id, created.id, "the percentage ceiling does not apply to flat cent amounts");
      assert.equal((await query<{ count: number }>("SELECT count(*)::int count FROM wl.employee_pay_rules WHERE employee_id=$1", [employeeId]))[0].count, 4);
    });
  } finally {
    globalThis.fetch = originalFetch;
    await closeDatabase();
  }
});
