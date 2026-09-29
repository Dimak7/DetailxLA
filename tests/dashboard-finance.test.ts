import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database, query, closeDatabase } from "../lib/platform/db";
import { expenseOccurrences, expenseSummary, type Expense } from "../lib/platform/finance";
import { payrollSummary } from "../lib/platform/payroll";
import { report, reportRange } from "../lib/platform/reporting";
import { adminAction } from "../lib/platform/admin";
import { dateToday, type Session } from "../lib/platform/types";

process.env.PGLITE_PATH = "memory://dashboard-finance";
Object.assign(process.env, { NODE_ENV: "test" });
delete process.env.DATABASE_URL;
delete process.env.RAILWAY_ENVIRONMENT;

const expense = (start: string, recurrence: Expense["recurrence"]): Expense => ({
  id: "fixture-expense", expense_date: start, amount_cents: 300000,
  category: "Rent", recurrence, recurring_start: start, recurring_end: null,
});

test("month-end expenses retain the original day after shorter months", () => {
  assert.deepEqual(
    expenseOccurrences(expense("2026-01-31", "monthly"), "2026-01-01", "2026-04-30").map((row) => row.date),
    ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"],
  );
  assert.deepEqual(
    expenseOccurrences(expense("2024-01-30", "monthly"), "2024-02-01", "2024-03-31").map((row) => row.date),
    ["2024-02-29", "2024-03-30"],
  );
  assert.deepEqual(
    expenseOccurrences({ ...expense("2026-01-31", "monthly"), recurring_end: "2026-03-15" }, "2026-02-01", "2026-12-31").map((row) => row.date),
    ["2026-02-28"],
  );
});

test("annual leap-day expenses and weekly/one-time boundaries remain stable", () => {
  assert.deepEqual(
    expenseOccurrences(expense("2024-02-29", "yearly"), "2024-01-01", "2028-12-31").map((row) => row.date),
    ["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"],
  );
  assert.deepEqual(
    expenseOccurrences(expense("2026-01-31", "weekly"), "2026-02-01", "2026-02-21").map((row) => row.date),
    ["2026-02-07", "2026-02-14", "2026-02-21"],
  );
  assert.equal(expenseOccurrences(expense("2026-01-31", "one_time"), "2026-02-01", "2026-02-28").length, 0);
});

test("week selection begins Monday", () => {
  const today = dateToday();
  const monday = new Date(`${today}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  assert.deepEqual(reportRange(new URLSearchParams({ range: "week" })), {
    start: monday.toISOString().slice(0, 10), end: today,
  });
});

test("financial dashboards handle high-value jobs, month-end costs and consistent weekly collections", async (t) => {
  try {
    await database();
    // Keep database assertions in one context to avoid the host's nested-subtest WASM issue.
    const service = (await query<{ id: string }>("SELECT id FROM wl.services LIMIT 1"))[0].id;
    const customer = randomUUID(), vehicle = randomUUID(), booking = randomUUID(), employee = randomUUID();
    await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone) VALUES($1,'Audit','Customer',$2,'')", [customer, `${customer}@example.test`]);
    await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Test','Coupe',2025,'Sedan')", [vehicle, customer]);
    await query("INSERT INTO wl.employees(id,name,position,hourly_rate_cents,compensation_model,default_commission_bps) VALUES($1,'Coating detailer','Detailer',1000,'hourly_commission',3000)", [employee]);
    await query(`INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,
      service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,status,price_cents)
      VALUES($1::uuid,$1::text,'fixture',$1::text,$2,$3,$4,'Ceramic coating','{}','2026-08-14',600,180,'completed',300000)`,
    [booking, customer, vehicle, service]);
    await query("INSERT INTO wl.employee_job_assignments(id,booking_id,employee_id,pool_share_bps) VALUES($1,$2,$3,10000)", [randomUUID(), booking, employee]);
    const payroll = await payrollSummary("2026-08-14", "2026-08-14");
    const row = payroll.find((entry) => entry.id === employee)!;
    assert.equal(Number(row.attributed_revenue), 300000);
    assert.equal(Number(row.commission_cents), 90000);
    assert.equal(Number(row.total_earnings_cents), 90000);
    t.diagnostic("$3,000 job returns its correct $900 detailer commission without integer overflow");

    await query("INSERT INTO wl.employee_shifts(id,employee_id,shift_date,start_minute,end_minute) VALUES($1,$2,'2026-08-14',540,1020)", [randomUUID(), employee]);
    await query("INSERT INTO wl.time_entries(id,employee_id,clock_in,clock_out,break_minutes) VALUES($1,$2,'2026-08-14T14:00:00Z','2026-08-14T15:00:00Z',60)", [randomUUID(), employee]);
    const zeroMinutes = (await payrollSummary("2026-08-14", "2026-08-14")).find((entry) => entry.id === employee)!;
    assert.equal(Number(zeroMinutes.actual_minutes), 0);
    assert.equal(Number(zeroMinutes.scheduled_minutes), 480);
    assert.equal(Number(zeroMinutes.minutes), 0);
    assert.equal(Number(zeroMinutes.hourly_earnings_cents), 0);
    assert.equal(zeroMinutes.paid_hours_source, "actual_clocked");
    t.diagnostic("a completed zero-payable-minute entry never falls back to an eight-hour scheduled shift");

    const manager = randomUUID(), ruleBooking = randomUUID(), exactRule = randomUUID();
    await query("INSERT INTO wl.employees(id,name,position,compensation_model,default_commission_bps) VALUES($1,'Commission manager','Manager','commission',1000)", [manager]);
    await query(`INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,
      service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,status,price_cents)
      VALUES($1::uuid,$1::text,'fixture',$1::text,$2,$3,$4,'Detail','{}','2026-08-15',600,60,'completed',10000)`,
    [ruleBooking, customer, vehicle, service]);
    await query("INSERT INTO wl.employee_job_assignments(id,booking_id,employee_id,pool_share_bps) VALUES($1,$2,$3,10000)", [randomUUID(), ruleBooking, manager]);
    await query(`INSERT INTO wl.employee_pay_rules(id,employee_id,service_id,rule_type,value,updated_at)
      VALUES($1,$2,NULL,'commission_percent',3000,'2026-01-01T12:00:00Z'),
      ($3,$2,NULL,'commission_percent',2000,'2026-02-01T12:00:00Z')`, [randomUUID(), manager, randomUUID()]);
    const general = (await payrollSummary("2026-08-15", "2026-08-15")).find((entry) => entry.id === manager)!;
    assert.equal(Number(general.commission_cents), 2000);
    assert.equal(Number(general.jobs_completed), 1);
    assert.equal(Number(general.attributed_revenue), 10000);
    await query("INSERT INTO wl.employee_pay_rules(id,employee_id,service_id,rule_type,value,updated_at) VALUES($1,$2,$3,'commission_percent',2500,'2025-01-01T12:00:00Z')", [exactRule, manager, service]);
    assert.equal(Number((await payrollSummary("2026-08-15", "2026-08-15")).find((entry) => entry.id === manager)!.commission_cents), 2500);
    await query("UPDATE wl.employee_pay_rules SET active=false WHERE id=$1", [exactRule]);
    assert.equal(Number((await payrollSummary("2026-08-15", "2026-08-15")).find((entry) => entry.id === manager)!.commission_cents), 2000);
    await query("UPDATE wl.employees SET compensation_model='flat_job',flat_job_pay_cents=1000 WHERE id=$1", [manager]);
    await query("INSERT INTO wl.employee_pay_rules(id,employee_id,rule_type,value) VALUES($1,$2,'flat_job',1500)", [randomUUID(), manager]);
    assert.equal(Number((await payrollSummary("2026-08-15", "2026-08-15")).find((entry) => entry.id === manager)!.commission_cents), 1500);
    t.diagnostic("all-service pay rules apply once, exact active rules override them, and the latest active rule wins within a scope");

    await query(`INSERT INTO wl.expenses(id,expense_date,amount_cents,category,recurrence,recurring_start)
      VALUES($1,'2026-01-31',300000,'Rent','monthly','2026-01-31')`, [randomUUID()]);
    const february = await expenseSummary("2026-02-01", "2026-02-28");
    const march = await expenseSummary("2026-03-01", "2026-03-31");
    assert.equal(february.total_cents, 300000);
    assert.deepEqual(february.byDay, [{ day: "2026-02-28", amount_cents: 300000 }]);
    assert.deepEqual(march.byDay, [{ day: "2026-03-31", amount_cents: 300000 }]);
    t.diagnostic("monthly expense totals include February and restore the March31 anchor");

    const today = dateToday();
    const monday = new Date(`${today}T12:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    const sunday = new Date(monday); sunday.setUTCDate(sunday.getUTCDate() - 1);
    await query(`INSERT INTO wl.square_payments(environment,payment_id,status,amount_cents,currency,paid_at)
      VALUES('production','previous-sunday','COMPLETED',1000,'USD',$1),
      ('production','current-monday','COMPLETED',2000,'USD',$2)`,
    [sunday.toISOString(), monday.toISOString()]);
    const weekly = await report(new URLSearchParams({ range: "week" }));
    assert.equal(weekly.revenue, 2000);
    assert.equal(weekly.windows.week, 2000);
    assert.deepEqual(weekly.series, [{ day: monday.toISOString().slice(0, 10), revenue: 2000 }]);
    t.diagnostic("selected week revenue equals the dashboard weekly window and excludes the prior Sunday");
  } finally {
    await closeDatabase();
  }
});

test("paid payroll snapshots reject repeated locks and period edits", { timeout: 10000 }, async () => {
  try {
    await database();
    const ownerId = randomUUID(), employee = randomUUID(), entry = randomUUID();
    const owner: Session = { id: "fixture-session", user_id: ownerId, name: "Payroll owner", email: "payroll-owner@example.test", role: "owner" };
    await query("INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,$2,$3,'unused-fixture-hash','owner')", [ownerId, owner.name, owner.email]);
    await query("INSERT INTO wl.employees(id,name,position,hourly_rate_cents,compensation_model) VALUES($1,'Hourly employee','Manager',2000,'hourly')", [employee]);
    await query(`INSERT INTO wl.time_entries(id,employee_id,clock_in,clock_out)
      VALUES($1,$2,'2026-08-16T14:00:00Z','2026-08-16T16:00:00Z'),
      ($3,$2,'2026-08-17T14:00:00Z','2026-08-17T17:00:00Z')`, [entry, employee, randomUUID()]);
    const input = { start_date: "2026-08-16", end_date: "2026-08-16", frequency: "weekly" };
    const period = await adminAction("save_pay_period", input, owner) as { id: string };
    assert.deepEqual(await adminAction("save_pay_period", input, owner), period);
    await adminAction("save_pay_period", { ...input, id: period.id, frequency: "biweekly" }, owner);

    const locks = await Promise.allSettled([
      adminAction("lock_pay_period", { id: period.id }, owner),
      adminAction("lock_pay_period", { id: period.id }, owner),
    ]);
    assert.equal(locks.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = locks.find((result) => result.status === "rejected") as PromiseRejectedResult;
    assert.match(rejected.reason.message, /already paid/);
    const snapshot = await query("SELECT * FROM wl.payroll_records WHERE pay_period_id=$1 ORDER BY employee_id", [period.id]);
    assert.equal(snapshot.length, 1);
    assert.equal(Number(snapshot[0].regular_minutes), 120);
    assert.equal(Number(snapshot[0].estimated_gross_cents), 4000, "the snapshot includes only time within this period");
    assert.equal((await query<{ status: string }>("SELECT status FROM wl.pay_periods WHERE id=$1", [period.id]))[0].status, "paid");

    await query("UPDATE wl.time_entries SET clock_out='2026-08-16T18:00:00Z' WHERE id=$1", [entry]);
    await assert.rejects(adminAction("lock_pay_period", { id: period.id }, owner), /already paid/);
    await assert.rejects(adminAction("save_pay_period", { ...input, id: period.id, end_date: "2026-08-17" }, owner), /Paid payroll periods cannot be changed/);
    await assert.rejects(adminAction("save_pay_period", input, owner), /Paid payroll periods cannot be changed/);
    assert.deepEqual(await query("SELECT * FROM wl.payroll_records WHERE pay_period_id=$1 ORDER BY employee_id", [period.id]), snapshot);
    assert.equal((await query<{ end_date: string }>("SELECT end_date FROM wl.pay_periods WHERE id=$1", [period.id]))[0].end_date, input.end_date);
    assert.equal((await query<{ count: number }>("SELECT count(*)::int count FROM wl.audit_logs WHERE entity_type='pay_period' AND entity_id=$1 AND action='locked'", [period.id]))[0].count, 1);
  } finally {
    await closeDatabase();
  }
});
