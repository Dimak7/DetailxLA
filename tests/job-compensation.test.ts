import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { calculateJobCompensation, allocateJobCents, type JobCompensationInput } from "../lib/platform/job-pay-calculation";
import { saveJobCompensation, jobCompensationSchema } from "../lib/platform/job-compensation";
import { query, closeDatabase } from "../lib/platform/db";
import { payrollSummary, preserveCompletedJobPay } from "../lib/platform/payroll";
import { transaction } from "../lib/platform/db";

process.env.PGLITE_PATH = "memory://job-compensation";
Object.assign(process.env, { NODE_ENV: "test" });
delete process.env.DATABASE_URL;
delete process.env.RAILWAY_ENVIRONMENT;

const example = (): JobCompensationInput => ({
  service_id: "detail", price_cents: 55000, paid_cents: 20000, tip_cents: 7500,
  tip_recipient_employee_id: "worker",
  line_items: [
    { id: "base", service_id: "detail", name: "Full detail", quantity: 1, unit_price_cents: 40000 },
    { id: "upgrade", service_id: "detail", name: "Sealant", quantity: 1, unit_price_cents: 15000 },
  ],
  employees: [{ id: "worker", compensation_model: "commission", default_commission_bps: 3000, flat_job_pay_cents: 0 }],
  assignments: [{ employee_id: "worker", pool_share_bps: 10000, pay_type: "default", line_pay_rules: [
    { line_item_id: "base", pay_type: "percentage", pay_value: 4000 },
    { line_item_id: "upgrade", pay_type: "percentage", pay_value: 5000 },
  ] }], service_rules: [],
});

test("line pay uses the full agreed amount and keeps a $75 tip separate from deposits", () => {
  for (const paid of [0, 20000, 55000]) {
    const row = calculateJobCompensation({ ...example(), paid_cents: paid })[0];
    assert.equal(row.commission_cents, 23500);
    assert.equal(row.tips_cents, 7500);
    assert.deepEqual(row.lines.map((line) => line.pay_cents), [16000, 7500]);
  }
  const wash = example();
  wash.price_cents = 2500;
  wash.line_items = [{ id: "base", service_id: "detail", name: "Wash", quantity: 1, unit_price_cents: 2500 }];
  const row = calculateJobCompensation(wash)[0];
  assert.equal(row.commission_cents, 1000);
  assert.equal(row.tips_cents, 7500);
});

test("discounts are allocated proportionally before separate base and upgrade rates", () => {
  const row = calculateJobCompensation({ ...example(), price_cents: 49500 })[0];
  assert.deepEqual(row.lines.map((line) => line.net_cents), [36000, 13500]);
  assert.deepEqual(row.lines.map((line) => line.pay_cents), [14400, 6750]);
  assert.equal(row.commission_cents, 21150);
  assert.equal(row.tips_cents, 7500);
});

test("explicit employee percentages and flat rates are final individual rates, not halved again", () => {
  const input = example();
  input.employees.push({ ...input.employees[0], id: "second" });
  input.assignments = [
    { employee_id: "worker", pool_share_bps: 5000, pay_type: "percentage", pay_value: 4000 },
    { employee_id: "second", pool_share_bps: 5000, pay_type: "flat", pay_value: 5000 },
  ];
  let rows = calculateJobCompensation(input);
  assert.deepEqual(rows.map((row) => row.commission_cents), [22000, 5000]);
  assert.deepEqual(rows.map((row) => row.tips_cents), [7500, 0]);
  rows = calculateJobCompensation({ ...input, tip_cents: 10001 });
  assert.deepEqual(rows.map((row) => row.tips_cents), [10001, 0], "future Square tips still belong entirely to the selected worker");
});

test("line overrides replace only their line and default flat pay is applied once", () => {
  const input = example();
  input.assignments[0].line_pay_rules = [{ line_item_id: "upgrade", pay_type: "flat", pay_value: 5000 }];
  assert.equal(calculateJobCompensation(input)[0].commission_cents, 17000);
  input.employees[0].compensation_model = "flat_job";
  input.employees[0].flat_job_pay_cents = 6000;
  assert.equal(calculateJobCompensation(input)[0].commission_cents, 11000);
  input.assignments[0].line_pay_rules.push({ line_item_id: "base", pay_type: "flat", pay_value: 9000 });
  assert.equal(calculateJobCompensation(input)[0].commission_cents, 14000, "no extra default flat fee when every line has its own pay");
});

test("legacy rounding, saved final amounts, and equal historical tips remain stable", () => {
  const input = example();
  input.price_cents = 199;
  input.tip_recipient_employee_id = null;
  input.tip_cents = 101;
  input.line_items = [
    { id: "a", service_id: "a", name: "A", quantity: 1, unit_price_cents: 100 },
    { id: "b", service_id: "b", name: "B", quantity: 1, unit_price_cents: 100 },
  ];
  input.employees.push({ ...input.employees[0], id: "second" });
  input.assignments = [{ employee_id: "worker", pool_share_bps: 5000 }, { employee_id: "second", pool_share_bps: 5000, commission_override_cents: 456 }];
  input.service_rules = ["a", "b"].map((service_id) => ({ employee_id: "worker", service_id, rule_type: "commission_percent", value: 3333 }));
  const rows = calculateJobCompensation(input);
  assert.equal(rows[0].commission_cents, 33);
  assert.equal(rows[1].commission_cents, 456);
  assert.deepEqual(rows[0].lines.map((line) => line.net_cents), [99, 100]);
  assert.equal(rows[0].tips_cents + rows[1].tips_cents, 101);
  assert.equal(rows[0].lines.reduce((sum, line) => sum + line.pay_cents, 0), 33);
  assert.deepEqual(allocateJobCents(101, [1, 1, 1]), [33, 34, 34]);
  assert.deepEqual(allocateJobCents(9, [0, 0]), [9, 0]);
});

test("job-rate validation rejects impossible percentages and fractional money", () => {
  const booking_id = randomUUID(), employee_id = randomUUID();
  assert.equal(jobCompensationSchema.safeParse({ booking_id, assignments: [{ employee_id, pool_share_bps: 10000, pay_type: "percentage", pay_value: 10001 }] }).success, false);
  assert.equal(jobCompensationSchema.safeParse({ booking_id, assignments: [{ employee_id, pool_share_bps: 10000, pay_type: "flat", pay_value: 1.5 }] }).success, false);
});

test("incomplete and non-finite editor values do not crash the pay preview", () => {
  const input = example();
  input.assignments[0].line_pay_rules = [{ line_item_id: "upgrade", pay_type: "percentage", pay_value: Number.POSITIVE_INFINITY }];
  input.assignments[0].pay_type = "percentage";
  input.assignments[0].pay_value = Number.NaN;
  assert.equal(calculateJobCompensation(input)[0].commission_cents, 0);
  assert.deepEqual(allocateJobCents(Number.POSITIVE_INFINITY, [1, 1]), [0, 0]);
});

test("saved job rates reach payroll, retain tips, protect history, and reject foreign lines", async () => {
  try {
    const service = (await query<{ id: string }>("SELECT id FROM wl.services ORDER BY id LIMIT 1"))[0];
    const actor = randomUUID(), customer = randomUUID(), vehicle = randomUUID(), booking = randomUUID(), employee = randomUUID(), second = randomUUID(), base = randomUUID(), upgrade = randomUUID();
    await query("INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,'Pay manager',$2,'fixture','manager')", [actor, `${actor}@example.test`]);
    await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone) VALUES($1,'Rate','Fixture',$2,'')", [customer, `${customer}@example.test`]);
    await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Test','Car',2026,'Sedan')", [vehicle, customer]);
    for (const id of [employee, second]) await query("INSERT INTO wl.employees(id,name,position,compensation_model,default_commission_bps) VALUES($1,'Detailer','Detailer','commission',3000)", [id]);
    await query(`INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,status,price_cents,tip_cents)
      VALUES($1::uuid,$1::text,'fixture',$1::text,$2,$3,$4,'Full detail','{}','2026-10-26',600,120,'completed',55000,7500)`, [booking, customer, vehicle, service.id]);
    await query("INSERT INTO wl.booking_line_items(id,booking_id,service_id,kind,name,quantity,unit_price_cents) VALUES($1,$2,$3,'base_service','Detail',1,40000),($4,$2,$3,'upsell','Sealant',1,15000)", [base, booking, service.id, upgrade]);
    await query("INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,status,kind) VALUES($1,$2,$3,20000,'paid','deposit')", [randomUUID(), booking, customer]);
    const input = { booking_id: booking, assignment_override: true, assignments: [{ employee_id: employee, pool_share_bps: 10000, pay_type: "default", pay_value: 0, line_rules: [
      { line_item_id: base, pay_type: "percentage", pay_value: 4000 },
      { line_item_id: upgrade, pay_type: "percentage", pay_value: 5000 },
    ] }] };
    await saveJobCompensation(input, actor);
    const total = async () => (await payrollSummary("2026-10-26", "2026-10-26")).find((row) => row.id === employee)!;
    assert.equal(Number((await total()).commission_cents), 23500);
    assert.equal(Number((await total()).tips_cents), 7500);
    assert.equal((await query<{ tip_recipient_employee_id: string }>("SELECT tip_recipient_employee_id FROM wl.bookings WHERE id=$1", [booking]))[0].tip_recipient_employee_id, employee);
    await query("UPDATE wl.bookings SET price_cents=49500,tip_cents=10000 WHERE id=$1", [booking]);
    assert.equal(Number((await total()).commission_cents), 21150);
    assert.equal(Number((await total()).tips_cents), 10000);
    await transaction((q) => preserveCompletedJobPay(q, employee));
    await query("UPDATE wl.employees SET default_commission_bps=9000 WHERE id=$1", [employee]);
    await saveJobCompensation(input, actor);
    assert.equal(Number((await total()).commission_cents), 21150, "a tip-only or repeated save preserves completed pay snapshot");
    input.assignments[0].line_rules[1].pay_value = 6000;
    await saveJobCompensation(input, actor);
    assert.equal(Number((await total()).commission_cents), 22500, "an intentional rate edit replaces the prior saved amount");
    const before = (await query("SELECT * FROM wl.employee_job_assignments WHERE booking_id=$1", [booking]))[0];
    await assert.rejects(() => saveJobCompensation({ ...input, assignments: [{ ...input.assignments[0], line_rules: [{ line_item_id: randomUUID(), pay_type: "flat", pay_value: 1 }] }] }, actor), /not part of this job/);
    assert.deepEqual((await query("SELECT * FROM wl.employee_job_assignments WHERE booking_id=$1", [booking]))[0], before);
    await assert.rejects(() => saveJobCompensation({ booking_id: booking, assignments: [
      { employee_id: employee, pool_share_bps: 5000 }, { employee_id: second, pool_share_bps: 5000 },
    ] }, actor), /receives this job's full tip/);
    await saveJobCompensation({ booking_id: booking, assignments: [], tip_recipient_employee_id: employee }, actor);
    assert.equal((await query("SELECT id FROM wl.employee_job_assignments WHERE booking_id=$1", [booking])).length, 0);
    assert.equal((await query<{ tip_recipient_employee_id: string | null }>("SELECT tip_recipient_employee_id FROM wl.bookings WHERE id=$1", [booking]))[0].tip_recipient_employee_id, null);
    await saveJobCompensation(input, actor);
    const period = randomUUID();
    await query("INSERT INTO wl.pay_periods(id,start_date,end_date,status) VALUES($1,'2026-10-26','2026-10-26','paid')", [period]);
    await query("INSERT INTO wl.payroll_records(id,pay_period_id,employee_id,hourly_rate_cents,estimated_gross_cents) VALUES($1,$2,$3,0,32500)", [randomUUID(), period, employee]);
    await assert.rejects(() => saveJobCompensation(input, actor), /paid payroll period/);
  } finally { await closeDatabase(); }
});
