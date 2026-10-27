import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { GET } from "../app/api/admin/employee-job-history/route";
import { employeeJobHistory } from "../lib/platform/employee-job-history";
import { closeDatabase, query } from "../lib/platform/db";
import { hash } from "../lib/platform/auth";
import { payrollSummary } from "../lib/platform/payroll";
import type { Role, Session } from "../lib/platform/types";

Object.assign(process.env, { NODE_ENV: "test", PGLITE_PATH: "memory://employee-job-history" });
delete process.env.DATABASE_URL;
delete process.env.RAILWAY_ENVIRONMENT;

async function person(role: Role = "staff") {
  const id = randomUUID(), employee = randomUUID(), token = randomBytes(32).toString("hex"), email = `${id}@example.test`;
  await query("INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,'History worker',$2,'test',$3)", [id, email, role]);
  await query("INSERT INTO wl.employees(id,user_id,name,position,compensation_model,default_commission_bps) VALUES($1,$2,'History worker','Detailer','commission',4000)", [employee, id]);
  await query("INSERT INTO wl.sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')", [hash(token), id]);
  return { employee, cookie: `wl_session=${token}`, user: { id: hash(token), user_id: id, name: "History worker", email, role } satisfies Session };
}

async function context() {
  const manager = await person("manager"), worker = await person(), second = await person();
  const service = (await query<{ id: string }>("SELECT id FROM wl.services ORDER BY id LIMIT 1"))[0].id;
  const customer = randomUUID(), vehicle = randomUUID();
  await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone) VALUES($1,'History','Customer',$2,'')", [customer, `${customer}@example.test`]);
  await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Porsche','911',2026,'Sedan')", [vehicle, customer]);
  return { manager, worker, second, service, customer, vehicle };
}
type Context = Awaited<ReturnType<typeof context>>;
async function job(c: Context, options: { status?: string; price?: number | null; tip?: number; date?: string; minute?: number; legacy?: boolean; archived?: boolean } = {}) {
  const id = randomUUID(), customer = options.archived ? randomUUID() : c.customer;
  if (options.archived) await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone,archived_at) VALUES($1,'Archived','Test',$2,'',now())", [customer, `${customer}@example.test`]);
  await query(`INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,status,price_cents,tip_cents,assigned_to,tip_recipient_employee_id)
    VALUES($1::uuid,$1::text,'fixture',$1::text,$2,$3,$4,'Full detail','{}',$5,$6,60,$7,$8,$9,$10,$11)`,
  [id, customer, c.vehicle, c.service, options.date || "2026-10-26", options.minute || 600, options.status || "completed", options.price === undefined ? 10000 : options.price, options.tip || 0, c.worker.user.user_id, c.worker.employee]);
  if (!options.legacy) await query("INSERT INTO wl.employee_job_assignments(id,booking_id,employee_id,pool_share_bps) VALUES($1,$2,$3,10000)", [randomUUID(), id, c.worker.employee]);
  return id;
}
const data = (c: Context, filters = {}) => employeeJobHistory({ employee_id: c.worker.employee, ...filters }, c.manager.user);

test("history matches payroll per job and service after discounts, without reducing pay for a deposit", async () => {
  try {
    const c = await context(), booking = await job(c, { price: 49500, tip: 7500 }), base = randomUUID(), upgrade = randomUUID();
    await query("INSERT INTO wl.booking_line_items(id,booking_id,service_id,kind,name,quantity,unit_price_cents) VALUES($1,$2,$3,'base_service','Full detail',1,40000),($4,$2,$3,'upsell','Ceramic sealant',1,15000)", [base, booking, c.service, upgrade]);
    await query("INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,status,kind) VALUES($1,$2,$3,20000,'paid','deposit')", [randomUUID(), booking, c.customer]);
    await query("UPDATE wl.employee_job_assignments SET pay_type='percentage',pay_value=4000,line_pay_rules=$2::jsonb WHERE booking_id=$1", [booking, JSON.stringify([{ line_item_id: upgrade, pay_type: "percentage", pay_value: 5000 }])]);
    const history = await data(c), row = history.jobs[0];
    assert.equal(row.vehicle, "2026 Porsche 911");
    assert.equal(row.customer_name, "History Customer");
    assert.equal(row.earned, true);
    assert.equal(row.job_pay_cents, 21150);
    assert.equal(row.tips_cents, 7500);
    assert.equal(row.total_earnings_cents, 28650);
    assert.deepEqual(row.lines.map(line => [line.name, line.net_cents, line.pay_cents, line.rate_label]), [["Full detail", 36000, 14400, "40% job rate"], ["Ceramic sealant", 13500, 6750, "50% of this line"]]);
    const payroll = (await payrollSummary("2026-10-26", "2026-10-26")).find(item => item.id === c.worker.employee)!;
    assert.equal(history.summary.job_pay_cents, payroll.commission_cents);
    assert.equal(history.summary.tips_cents, payroll.tips_cents);
    assert.equal(history.summary.total_earnings_cents, payroll.total_earnings_cents);
    assert.equal(history.summary.service_total_cents, 49500);
  } finally { await closeDatabase(); }
});

test("saved job pay stays exact and legacy assignment falls back only when no explicit team exists", async () => {
  try {
    const c = await context(), saved = await job(c), legacy = await job(c, { legacy: true, date: "2025-01-02" }), reassigned = await job(c);
    await query("UPDATE wl.employee_job_assignments SET commission_override_cents=12345 WHERE booking_id=$1", [saved]);
    await query("UPDATE wl.employees SET default_commission_bps=9000,active=false WHERE id=$1", [c.worker.employee]);
    await query("UPDATE wl.employee_job_assignments SET employee_id=$2 WHERE booking_id=$1", [reassigned, c.second.employee]);
    const history = await data(c);
    assert.equal(history.employee.active, false);
    assert.equal(history.pagination.total, 2);
    assert.ok(history.jobs.some(row => row.id === legacy), "all-time includes earlier years");
    assert.ok(!history.jobs.some(row => row.id === reassigned), "stale primary field must not duplicate assigned history");
    const savedRow = history.jobs.find(row => row.id === saved)!;
    assert.equal(savedRow.job_pay_cents, 12345);
    assert.equal(savedRow.lines.reduce((sum, line) => sum + line.pay_cents, 0), 12345);
    assert.equal(savedRow.lines[0].name, "Full detail");
    assert.match(savedRow.pay_note!, /not a record of historical line rates/);
    assert.equal(savedRow.lines[0].rate_label, "Saved job pay · allocated to this line");
  } finally { await closeDatabase(); }
});

test("team jobs show only the selected worker's earnings and full tip recipient", async () => {
  try {
    const c = await context(), booking = await job(c, { price: 55000, tip: 7500 });
    await query("UPDATE wl.employee_job_assignments SET pool_share_bps=5000,pay_type='percentage',pay_value=4000 WHERE booking_id=$1", [booking]);
    await query("INSERT INTO wl.employee_job_assignments(id,booking_id,employee_id,pool_share_bps,pay_type,pay_value) VALUES($1,$2,$3,5000,'flat',8000)", [randomUUID(), booking, c.second.employee]);
    const first = (await data(c)).jobs[0];
    const second = (await employeeJobHistory({ employee_id: c.second.employee }, c.manager.user)).jobs[0];
    assert.equal(first.job_pay_cents, 22000);
    assert.equal(first.tips_cents, 7500);
    assert.equal(second.job_pay_cents, 8000);
    assert.equal(second.tips_cents, 0);
    assert.match(second.lines[0].rate_label, /\$80\.00 flat job pay/);
  } finally { await closeDatabase(); }
});

test("all-time summaries cover every page, distinguish pending work, and exclude archived tests", async () => {
  try {
    const c = await context();
    for (let index = 0; index < 26; index++) await job(c, { minute: 500 + index });
    await job(c, { status: "confirmed" });
    await job(c, { status: "in_progress" });
    const cancelled = await job(c, { status: "cancelled", tip: 9000 });
    await job(c, { status: "no_show", tip: 1000 });
    await job(c, { archived: true });
    const history = await data(c);
    assert.equal(history.jobs.length, 25);
    assert.equal(history.pagination.total, 30);
    assert.equal(history.summary.completed_jobs, 26);
    assert.equal(history.summary.job_pay_cents, 104000);
    assert.equal(history.summary.tips_cents, 0);
    assert.equal(history.summary.pending_jobs, 2);
    assert.equal(history.summary.pending_job_pay_cents, 8000);
    assert.deepEqual((await data(c, { page: 2 })).summary, history.summary);
    const completed = await data(c, { status: "completed", page: 2 });
    assert.equal(completed.jobs.length, 1);
    assert.equal(completed.summary.completed_jobs, 26);
    assert.equal(completed.summary.pending_jobs, 0);
    const cancelledRow = (await data(c, { status: "cancelled" })).jobs[0];
    assert.equal(cancelledRow.id, cancelled);
    assert.equal(cancelledRow.earned, false);
    assert.equal(cancelledRow.total_earnings_cents, 0);
    assert.equal(cancelledRow.lines[0].pay_cents, 0);
    assert.equal((await data(c, { end: "2026-10-25" })).pagination.total, 0);
  } finally { await closeDatabase(); }
});

test("unagreed price is clearly provisional while keeping payroll's historical receipt fallback", async () => {
  try {
    const c = await context(), booking = await job(c, { price: null });
    await query("INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,status,kind) VALUES($1,$2,$3,10000,'paid','deposit')", [randomUUID(), booking, c.customer]);
    const row = (await data(c)).jobs[0];
    assert.equal(row.service_total_cents, null);
    assert.equal(row.quote_pending, true);
    assert.equal(row.job_pay_cents, 4000);
    assert.match(row.pay_note!, /No agreed service price/);
    const payroll = (await payrollSummary("2026-10-26", "2026-10-26")).find(item => item.id === c.worker.employee)!;
    assert.equal(row.job_pay_cents, payroll.commission_cents);
  } finally { await closeDatabase(); }
});

test("history API enforces payroll access, private caching, identifiers and date validation", async () => {
  try {
    const c = await context();
    await job(c);
    const url = `https://example.test/api/admin/employee-job-history?employee_id=${c.worker.employee}`;
    assert.equal((await GET(new Request(url))).status, 401);
    assert.equal((await GET(new Request(url, { headers: { Cookie: c.worker.cookie } }))).status, 403);
    await assert.rejects(employeeJobHistory({ employee_id: c.worker.employee }, c.worker.user), /does not have access/);
    for (const role of ["owner", "admin", "manager"] as Role[]) {
      const actor = role === "manager" ? c.manager : await person(role);
      const response = await GET(new Request(url, { headers: { Cookie: actor.cookie } }));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
      assert.equal((await response.json()).ok, true);
    }
    for (const suffix of ["&start=2026-02-30", "&start=2026-10-27&end=2026-10-26", "&status=invalid", "&page=-1"])
      assert.equal((await GET(new Request(url + suffix, { headers: { Cookie: c.manager.cookie } }))).status, 400);
    assert.equal((await GET(new Request(`https://example.test/api/admin/employee-job-history?employee_id=${randomUUID()}`, { headers: { Cookie: c.manager.cookie } }))).status, 404);
    assert.equal((await GET(new Request("https://example.test/api/admin/employee-job-history?employee_id=not-an-id", { headers: { Cookie: c.manager.cookie } }))).status, 400);
  } finally { await closeDatabase(); }
});
