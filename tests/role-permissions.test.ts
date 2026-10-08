import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { workAsyncStorage, type WorkStore } from "next/dist/server/app-render/work-async-storage.external";
import { GET as manageGet, POST as managePost } from "../app/api/manage/route";
import { GET as employeeMe } from "../app/api/employee/me/route";
import { POST as employeeClock } from "../app/api/employee/clock/route";
import { access, AppError, hash, sessionFromToken } from "../lib/platform/auth";
import { adminAction, adminData } from "../lib/platform/admin";
import { updateBooking } from "../lib/platform/bookings";
import { closeDatabase, query } from "../lib/platform/db";
import { dateToday, type Role, type Session, type Service } from "../lib/platform/types";

process.env.PGLITE_PATH = "memory://role-permissions";
Object.assign(process.env, { NODE_ENV: "test" });
delete process.env.DATABASE_URL;
delete process.env.RAILWAY_ENVIRONMENT;
delete process.env.ADMIN_EMAIL;
delete process.env.ADMIN_PASSWORD;
for (const key of ["SQUARE_ACCESS_TOKEN", "STRIPE_SECRET_KEY", "TELEGRAM_BOT_TOKEN", "TWILIO_AUTH_TOKEN", "EMAIL_PROVIDER_API_KEY", "RESEND_API_KEY"])
  delete process.env[key];

const forbidden = (error: unknown) => error instanceof AppError && error.status === 403;
const asRows = (value: unknown) => value as Array<Record<string, unknown>>;

test("section permissions match the owner, admin, manager and staff workspaces", () => {
  for (const role of ["owner", "admin"] as const)
    assert.ok(Object.values(access).every((roles) => roles.includes(role)), `${role} sees every workspace`);
  assert.deepEqual(Object.keys(access).filter((section) => access[section].includes("manager")).sort(), [
    "bookings", "calendar", "customers", "dashboard", "employees", "gallery", "hours", "leads", "messages",
    "my_schedule", "payments", "payroll", "performance", "reviews", "schedule", "services",
  ].sort());
  assert.deepEqual(Object.keys(access).filter((section) => access[section].includes("staff")).sort(), ["bookings", "calendar", "my_schedule"]);
});

test("role boundaries are enforced in API responses, employee accounts and assigned jobs", async (t) => {
  t.mock.method(workAsyncStorage, "getStore", () => ({ afterContext: { after() {} } }) as unknown as WorkStore);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Role tests must not call external providers"); });
  const account = async (role: Role) => {
    const id = randomUUID(), token = randomBytes(32).toString("hex");
    const session: Session = { id: hash(token), user_id: id, name: `${role} fixture`, email: `${id}@example.test`, role };
    await query("INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,$2,$3,'fixture',$4)", [id, session.name, session.email, role]);
    await query("INSERT INTO wl.sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')", [session.id, id]);
    return { session, token };
  };
  type Account = Awaited<ReturnType<typeof account>>;
  const request = (fixture: Account, section: string, parameters: Record<string, string> = {}) =>
    new Request(`https://example.test/api/manage?${new URLSearchParams({ section, ...parameters })}`, { headers: { Cookie: `wl_session=${fixture.token}` } });
  const action = (fixture: Account, name: string, data: unknown) => managePost(new Request("https://example.test/api/manage", {
    method: "POST", headers: { Origin: "https://example.test", Cookie: `wl_session=${fixture.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: name, data }),
  }));
  const availability = Array.from({ length: 7 }, (_, weekday) => ({ weekday, available: true, start_minute: 480, end_minute: 1200 }));
  const employeeInput = (email = `${randomUUID()}@example.test`) => ({ name: "Employee fixture", email, phone: "+13125550123", password: "Fixture-password-long-4821", position: "Detailer", hourly_rate_cents: 2500, hire_date: null, notes: "Fixture work notes", active: true, availability });
  const linkedEmployee = async (fixture: Account) => {
    const id = randomUUID();
    await query("INSERT INTO wl.employees(id,user_id,name,email,phone,position,hourly_rate_cents) VALUES($1,$2,$3,$4,'+13125550123','Detailer',2500)", [id, fixture.session.user_id, fixture.session.name, fixture.session.email]);
    return id;
  };
  try {
    const owner = await account("owner"), admin = await account("admin"), manager = await account("manager"), staff = await account("staff"), otherStaff = await account("staff");
    const ownerEmployee = await linkedEmployee(owner), adminEmployee = await linkedEmployee(admin), managerEmployee = await linkedEmployee(manager);
    const staffEmployee = await linkedEmployee(staff), otherEmployee = await linkedEmployee(otherStaff);
    const period = { start: dateToday(), end: dateToday() };

    for (const section of ["employees", "payroll", "hours", "schedule"]) {
      assert.equal((await manageGet(request(manager, section, period))).status, 200, `manager can read ${section}`);
      assert.equal((await manageGet(request(staff, section, period))).status, 403, `staff cannot read ${section}`);
    }
    assert.equal((await manageGet(request(manager, "payroll", { ...period, export: "csv" }))).status, 200);
    assert.equal((await manageGet(request(staff, "payroll", { ...period, export: "csv" }))).status, 403);
    for (const section of ["settings", "team", "marketing", "analytics", "reports", "expenses", "inventory"])
      assert.equal((await manageGet(request(manager, section))).status, 403, `manager cannot read ${section}`);
    assert.equal((await manageGet(request(admin, "settings"))).status, 200);
    assert.equal((await manageGet(request(admin, "team"))).status, 200);
    await query("INSERT INTO wl.ad_spend(id,channel,campaign,spend_date,amount_cents) VALUES($1,'Google Ads','Private campaign',$2,9000)", [randomUUID(), dateToday()]);
    await query("INSERT INTO wl.campaigns(id,name,channel,audience,body) VALUES($1,'Private campaign','email','all','Private campaign copy')", [randomUUID()]);
    await query("INSERT INTO wl.expenses(id,expense_date,amount_cents,category) VALUES($1,$2,12000,'Private overhead')", [randomUUID(), dateToday()]);
    await query("INSERT INTO wl.inventory_items(id,name,quantity,unit_cost_cents) VALUES($1,'Private inventory',3,4500)", [randomUUID()]);
    const managerDashboard = await (await manageGet(request(manager, "dashboard"))).json();
    assert.deepEqual(managerDashboard.spend, []);
    assert.deepEqual(managerDashboard.campaigns, []);
    assert.equal("inventory" in managerDashboard, false);
    for (const key of ["expenses", "expense_summary", "net_operating_profit", "operating_margin", "financial_series", "spend", "conversion_rate", "events", "channels", "lead_streams", "google_ads", "campaigns"])
      assert.equal(key in managerDashboard.report, false, `manager dashboard must not expose ${key}`);
    for (const key of ["revenue", "bookings", "customers", "labor_cost", "topServices", "series"])
      assert.ok(key in managerDashboard.report, `manager dashboard retains operational ${key}`);
    const adminDashboard = await (await manageGet(request(admin, "dashboard"))).json();
    assert.equal(adminDashboard.spend.length, 1);
    assert.equal(adminDashboard.campaigns.length, 1);
    assert.equal(adminDashboard.report.expenses, 12000);
    assert.equal(adminDashboard.inventory.value_cents, 13500);
    for (const name of ["save_user", "save_settings", "test_telegram", "save_campaign"])
      assert.equal((await action(manager, name, {})).status, 403, `manager cannot perform ${name}`);
    for (const name of ["save_employee", "save_employee_compensation", "save_pay_rule", "save_shift", "approve_time", "create_payment", "save_settings"])
      assert.equal((await action(staff, name, {})).status, 403, `staff cannot perform ${name}`);

    // A job title never grants account access. Managers can still add staff and manage their pay.
    const staffInput = { ...employeeInput(), position: "Manager" };
    const createdResponse = await action(manager, "save_employee", staffInput);
    assert.equal(createdResponse.status, 200);
    const createdId = String((await createdResponse.json()).result.id);
    const created = (await query<{ user_id: string; position: string }>("SELECT user_id,position FROM wl.employees WHERE id=$1", [createdId]))[0];
    assert.equal(created.position, "Manager");
    assert.equal((await query<{ role: string }>("SELECT role FROM wl.users WHERE id=$1", [created.user_id]))[0].role, "staff");
    assert.equal((await action(manager, "save_employee_compensation", { employee_id: createdId, compensation_model: "hourly", hourly_rate_cents: 3000, default_commission_bps: 0, flat_job_pay_cents: 0 })).status, 200);
    assert.equal((await query<{ hourly_rate_cents: number }>("SELECT hourly_rate_cents FROM wl.employees WHERE id=$1", [createdId]))[0].hourly_rate_cents, 3000);
    assert.equal((await action(manager, "save_employee", { ...employeeInput(), login_role: "manager" })).status, 403);
    assert.equal((await action(manager, "save_employee", { ...staffInput, id: createdId, login_role: "manager" })).status, 403);

    // Linked employee records must not provide a second way to reset or disable privileged accounts.
    for (const [fixture, id] of [[owner, ownerEmployee], [admin, adminEmployee], [manager, managerEmployee]] as const) {
      const beforeAccount = await query("SELECT * FROM wl.users WHERE id=$1", [fixture.session.user_id]);
      const beforeEmployee = await query("SELECT * FROM wl.employees WHERE id=$1", [id]);
      assert.equal((await action(manager, "save_employee", { ...employeeInput(fixture.session.email), id, active: false })).status, 403);
      assert.deepEqual(await query("SELECT * FROM wl.users WHERE id=$1", [fixture.session.user_id]), beforeAccount);
      assert.deepEqual(await query("SELECT * FROM wl.employees WHERE id=$1", [id]), beforeEmployee);
    }
    assert.equal((await action(admin, "save_employee", { ...employeeInput(owner.session.email), id: ownerEmployee })).status, 403);
    assert.equal((await action(manager, "save_employee", { ...staffInput, id: createdId, password: "short" })).status, 400);

    const previousToken = randomBytes(32).toString("hex");
    await query("INSERT INTO wl.sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')", [hash(previousToken), created.user_id]);
    assert.ok(await sessionFromToken(previousToken));
    assert.equal((await action(admin, "save_employee", { ...staffInput, id: createdId, login_role: "manager", password: "" })).status, 200);
    assert.equal((await query<{ role: string }>("SELECT role FROM wl.users WHERE id=$1", [created.user_id]))[0].role, "manager");
    assert.equal(await sessionFromToken(previousToken), null, "changing access revokes existing sessions");
    assert.equal((await action(owner, "save_employee", { ...employeeInput(), login_role: "manager" })).status, 200);
    const employeeData = await adminData("employees", new URLSearchParams(), admin.session);
    assert.equal(asRows(employeeData.rows).find((row) => row.id === createdId)?.login_role, "manager");

    const teamInput = { name: "Team fixture", email: `${randomUUID()}@example.test`, password: "Fixture-team-password-4821", role: "staff", active: false };
    assert.equal((await action(admin, "save_user", teamInput)).status, 200);
    assert.equal((await query<{ active: boolean }>("SELECT active FROM wl.users WHERE email=$1", [teamInput.email]))[0].active, false);
    assert.equal((await action(admin, "save_user", { ...teamInput, email: `${randomUUID()}@example.test`, role: "owner" })).status, 403);
    assert.equal((await action(admin, "save_user", { ...teamInput, id: owner.session.user_id, email: owner.session.email })).status, 403);
    assert.equal((await action(owner, "save_user", { ...teamInput, id: owner.session.user_id, email: owner.session.email, role: "owner", active: false })).status, 403);
    assert.equal((await action(admin, "save_user", { ...teamInput, id: admin.session.user_id, email: admin.session.email, role: "manager", active: true })).status, 403);
    assert.equal((await action(admin, "save_user", { ...teamInput, id: admin.session.user_id, email: admin.session.email, password: "", role: "admin", active: true })).status, 200, "admin can edit their own profile without changing access");
    assert.equal(await sessionFromToken(admin.token), null, "team access edits invalidate the target sessions");

    const services = await query<Service>("SELECT * FROM wl.services ORDER BY sort_order LIMIT 1");
    const customer = randomUUID(), vehicle = randomUUID(), today = dateToday();
    await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone) VALUES($1,'Assigned','Customer',$2,'+13125550123')", [customer, `${customer}@example.test`]);
    await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Fixture','Coupe',2025,'Sedan')", [vehicle, customer]);
    const addBooking = async (assignedTo: string, status = "confirmed") => {
      const id = randomUUID();
      await query(`INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,status,price_cents,tip_cents,assigned_to)
        VALUES($1::uuid,$1::text,'private-fixture-hash',$1::text,$2,$3,$4,'Fixture detail',$5::jsonb,$6,600,60,$7,10000,1500,$8)`, [id, customer, vehicle, services[0].id, JSON.stringify(services[0]), today, status, assignedTo]);
      return id;
    };
    const ownJob = await addBooking(staff.session.user_id), foreignJob = await addBooking(otherStaff.session.user_id);
    await query("INSERT INTO wl.blocks(id,booking_date,start_minute,end_minute,reason) VALUES($1,$2,1200,1260,'Private global block')", [randomUUID(), today]);
    for (const [employeeId, published] of [[staffEmployee, true], [staffEmployee, false], [otherEmployee, true]] as const)
      await query("INSERT INTO wl.employee_shifts(id,employee_id,shift_date,start_minute,end_minute,published) VALUES($1,$2,$3,480,1080,$4)", [randomUUID(), employeeId, today, published]);
    for (const employeeId of [staffEmployee, otherEmployee])
      await query("INSERT INTO wl.time_entries(id,employee_id,clock_in,clock_out) VALUES($1,$2,now()-interval '2 hours',now()-interval '1 hour')", [randomUUID(), employeeId]);

    for (const section of ["bookings", "calendar"]) {
      const response = await manageGet(request(staff, section, { date: today }));
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.deepEqual(data.rows.map((row: Record<string, unknown>) => row.id), [ownJob]);
      assert.deepEqual(data.team, []);
      assert.deepEqual(data.employees, []);
      assert.deepEqual(data.blocks, []);
      assert.deepEqual(data.payments, []);
      for (const key of ["price_cents", "tip_cents", "deposit_cents", "service_snapshot", "request_hash", "request_key", "internal_notes"])
        assert.equal(key in data.rows[0], false, `${section} must not expose ${key}`);
      assert.ok(data.services.every((service: Record<string, unknown>) => !("price_cents" in service)));
    }
    const scheduleResponse = await manageGet(request(staff, "my_schedule", { employee_id: otherEmployee }));
    const schedule = await scheduleResponse.json();
    assert.equal(schedule.employee.id, staffEmployee);
    assert.deepEqual(schedule.appointments.map((job: Record<string, unknown>) => job.id), [ownJob]);
    assert.ok(schedule.appointments.every((job: Record<string, unknown>) => !("price_cents" in job)));
    assert.equal(schedule.shifts.length, 1);
    assert.equal(schedule.shifts[0].employee_id, staffEmployee);
    assert.ok(schedule.entries.every((entry: Record<string, unknown>) => entry.employee_id === staffEmployee));
    const selfRequest = (url: string) => new Request(url, { headers: { Cookie: `wl_session=${staff.token}` } });
    const me = await (await employeeMe(selfRequest(`https://example.test/api/employee/me?employee_id=${otherEmployee}`))).json();
    assert.equal(me.employee.id, staffEmployee);
    assert.ok(me.entries.every((entry: Record<string, unknown>) => entry.employee_id === staffEmployee));
    const clock = await employeeClock(new Request("https://example.test/api/employee/clock", {
      method: "POST", headers: { Origin: "https://example.test", Cookie: `wl_session=${staff.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "in", employee_id: otherEmployee }),
    }));
    assert.equal(clock.status, 200);
    assert.deepEqual((await query("SELECT employee_id FROM wl.time_entries WHERE clock_out IS NULL")).map((entry) => entry.employee_id), [staffEmployee]);

    const notes = await action(staff, "update_booking", { id: ownJob, status: "confirmed", notes: "Work notes" });
    assert.equal(notes.status, 200, "staff can keep an existing status while editing notes");
    const result = (await notes.json()).result;
    assert.equal(result.notes, "Work notes");
    for (const key of ["price_cents", "tip_cents", "deposit_cents", "service_snapshot", "request_hash", "request_key", "internal_notes"])
      assert.equal(key in result, false, `job action must not expose ${key}`);
    const before = await query("SELECT * FROM wl.bookings WHERE id=$1", [ownJob]);
    for (const edit of [{ status: "new" }, { status: "cancelled" }, { status: "no_show" }, { price_cents: 1 }, { assigned_to: staff.session.user_id }, { date: today }, { start_minute: 600 }, { assignment_override: true }, { internal_notes: "Private manager notes" }])
      assert.equal((await action(staff, "update_booking", { id: ownJob, ...edit })).status, 403);
    assert.deepEqual(await query("SELECT * FROM wl.bookings WHERE id=$1", [ownJob]), before);
    assert.equal((await action(staff, "update_booking", { id: foreignJob, status: "in_progress" })).status, 403);
    await assert.rejects(() => updateBooking(ownJob, { price_cents: 1 }, staff.session.user_id, true), forbidden);
    assert.equal((await action(staff, "update_booking", { id: ownJob, status: "in_progress" })).status, 200);
    assert.equal((await action(staff, "update_booking", { id: ownJob, status: "completed" })).status, 200);
    assert.equal((await action(staff, "update_booking", { id: ownJob, status: "in_progress" })).status, 403, "staff cannot reopen completed jobs");
    const cancelled = await addBooking(staff.session.user_id, "cancelled");
    assert.equal((await action(staff, "update_booking", { id: cancelled, status: "completed" })).status, 403, "staff cannot reopen cancelled jobs");
  } finally {
    await closeDatabase();
  }
});
