import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { POST as signIn } from "../app/api/admin/login/route";
import { POST as requestReset } from "../app/api/admin/reset/route";
import { GET as employeeMe } from "../app/api/employee/me/route";
import { POST as clock } from "../app/api/employee/clock/route";
import { adminAction, adminData } from "../lib/platform/admin";
import { createReset, login, passwordHash, resetPassword, sessionFromToken } from "../lib/platform/auth";
import { closeDatabase, query } from "../lib/platform/db";
import type { Role, Session } from "../lib/platform/types";

Object.assign(process.env, { NODE_ENV: "test", PGLITE_PATH: "memory://employee-login" });
for (const key of ["DATABASE_URL", "RAILWAY_ENVIRONMENT", "ADMIN_EMAIL", "ADMIN_PASSWORD", "SQUARE_ACCESS_TOKEN", "STRIPE_SECRET_KEY", "RESEND_API_KEY", "EMAIL_PROVIDER_API_KEY", "TELEGRAM_BOT_TOKEN", "TWILIO_AUTH_TOKEN"])
  delete process.env[key];
const password = "Employee-test-password-9265";
const requestLogin = (email: string, value = password) => signIn(new Request("https://example.test/api/admin/login", {
  method: "POST", headers: { "Content-Type": "application/json", Origin: "https://example.test" }, body: JSON.stringify({ email, password: value }),
}));
const createAccount = async (role: Role, email = `${randomUUID()}@example.test`) => {
  const id = randomUUID();
  await query("INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,'Worker fixture',$2,$3,$4)", [id, email, passwordHash(password), role]);
  return { id, email, role };
};

test("employee and manager logins issue sessions and open only the appropriate workspace", async () => {
  try {
    const owner = await createAccount("owner");
    const actor: Session = { id: "test-owner-session", user_id: owner.id, name: "Owner", email: owner.email, role: "owner" };
    const manager = await adminAction("save_user", { name: "Manager fixture", email: "manager@example.test", password, role: "manager", active: true }, actor) as { id: string };
    const managerResponse = await requestLogin("manager@example.test");
    assert.equal(managerResponse.status, 200);
    assert.equal((await managerResponse.json()).redirectTo, "/admin/dashboard");
    const managerSession = (await sessionFromToken(await login("manager@example.test", password, "manager-fixture")))!;
    assert.equal(managerSession.user_id, manager.id);
    assert.equal(managerSession.role, "manager");
    const created = await adminAction("save_employee", {
      name: "Detailer fixture", email: "employee@example.test", phone: "3125550109", password,
      position: "Detailer", hourly_rate_cents: 2500, max_weekly_minutes: 2400, hire_date: null, notes: "", active: true,
      availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, available: weekday !== 0, start_minute: 480, end_minute: 1200 })),
    }, managerSession) as { id: string };
    const response = await requestLogin("employee@example.test");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).redirectTo, "/admin/my_schedule");
    const cookie = response.headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly/);
    const token = cookie.match(/wl_session=([a-f0-9]{64})/)![1];
    const user = (await sessionFromToken(token))!;
    assert.equal(user.role, "staff");
    const schedule = await adminData("my_schedule", new URLSearchParams(), user);
    assert.equal((schedule.employee as { id: string }).id, created.id);
    assert.equal((await employeeMe(new Request("https://example.test/api/employee/me", { headers: { Cookie: cookie } }))).status, 200);
    const clockIn = await clock(new Request("https://example.test/api/employee/clock", { method: "POST", headers: { Origin: "https://example.test", Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ action: "in" }) }));
    assert.equal(clockIn.status, 200);
    await assert.rejects(adminData("employees", new URLSearchParams(), user), /does not have access/);
    await assert.rejects(adminData("payroll", new URLSearchParams(), user), /does not have access/);
    await assert.rejects(adminData("settings", new URLSearchParams(), managerSession), /does not have access/);
  } finally { await closeDatabase(); }
});

test("legacy logins accept normalized email and repair only unambiguous active staff profiles", async () => {
  try {
    const account = await createAccount("staff", "Legacy.Worker@Example.Test");
    const employeeId = randomUUID();
    await query("INSERT INTO wl.employees(id,name,email,phone,position,hourly_rate_cents) VALUES($1,'Existing worker','legacy.worker@example.test','3125550120','Detailer',2700)", [employeeId]);
    const response = await requestLogin("  LEGACY.WORKER@example.test  ");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).redirectTo, "/admin/my_schedule");
    const employee = (await query<{ id: string; user_id: string; hourly_rate_cents: number }>("SELECT id,user_id,hourly_rate_cents FROM wl.employees WHERE user_id=$1", [account.id]))[0];
    assert.equal(employee.id, employeeId);
    assert.equal(employee.hourly_rate_cents, 2700);
    await login("legacy.worker@example.test", password, "repeat-login");
    assert.equal((await query("SELECT id FROM wl.employees WHERE user_id=$1", [account.id])).length, 1);
    const reset = await createReset(" LEGACY.WORKER@example.test ", "reset-fixture");
    assert.ok(reset);
    await resetPassword(reset, password + "-new");
    assert.ok(await sessionFromToken(await login("legacy.worker@example.test", password + "-new", "reset-login")));

    const noProfile = await createAccount("staff");
    await login(noProfile.email, password, "no-profile");
    assert.equal((await query("SELECT id FROM wl.employees WHERE user_id=$1 AND active=true", [noProfile.id])).length, 1);
    const inactive = await createAccount("staff");
    const inactiveId = randomUUID();
    await query("INSERT INTO wl.employees(id,email,active) VALUES($1,$2,false)", [inactiveId, inactive.email]);
    await login(inactive.email, password, "inactive-profile");
    assert.deepEqual(await query("SELECT user_id,active FROM wl.employees WHERE id=$1", [inactiveId]), [{ user_id: null, active: false }]);
    assert.equal((await query("SELECT id FROM wl.employees WHERE user_id=$1", [inactive.id])).length, 0);
    const ambiguous = await createAccount("staff");
    for (let index = 0; index < 2; index++) await query("INSERT INTO wl.employees(id,email) VALUES($1,$2)", [randomUUID(), ambiguous.email]);
    await login(ambiguous.email, password, "ambiguous-profiles");
    assert.equal((await query("SELECT id FROM wl.employees WHERE user_id=$1", [ambiguous.id])).length, 0);
    const badPassword = await createAccount("staff");
    assert.equal((await requestLogin(badPassword.email, "incorrect")).status, 401);
    assert.equal((await query("SELECT id FROM wl.employees WHERE user_id=$1", [badPassword.id])).length, 0);
    const removed = await createAccount("staff");
    await query("UPDATE wl.users SET removed_at=now() WHERE id=$1", [removed.id]);
    assert.equal((await requestLogin(removed.email)).status, 401);
  } finally { await closeDatabase(); }
});


test("managers can repair a worker login link without duplicating profiles or changing privileged accounts", async () => {
  try {
    const manager = await createAccount("manager");
    const actor: Session = { id: "fixture", user_id: manager.id, name: "Manager", email: manager.email, role: "manager" };
    const employee = await createAccount("staff", "Repair.Worker@example.test");
    const profile = randomUUID();
    await query("INSERT INTO wl.employees(id,name,email,hourly_rate_cents) VALUES($1,'Existing profile',$2,3100)", [profile, employee.email]);
    const input = { id: profile, name: "Repaired worker", email: " repair.worker@example.test ", phone: "3125550140", password: "",
      position: "Detailer", max_weekly_minutes: 2400, hire_date: null, notes: "Existing staff", active: true,
      availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, available: true, start_minute: 480, end_minute: 1200 })) };
    await adminAction("save_employee", input, actor);
    const record = (await query<{ user_id: string; hourly_rate_cents: number }>("SELECT user_id,hourly_rate_cents FROM wl.employees WHERE id=$1", [profile]))[0];
    assert.equal(record.user_id, employee.id);
    assert.equal(record.hourly_rate_cents, 3100);
    assert.ok(await sessionFromToken(await login("repair.worker@example.test", password, "repaired")));
    assert.equal((await query("SELECT id FROM wl.employees WHERE user_id=$1", [employee.id])).length, 1);
    const privileged = await createAccount("admin");
    const otherProfile = randomUUID();
    await query("INSERT INTO wl.employees(id,name,email) VALUES($1,'Unlinked admin',$2)", [otherProfile, privileged.email]);
    await assert.rejects(adminAction("save_employee", { ...input, id: otherProfile, email: privileged.email }, actor), /cannot change this employee account/);
    assert.equal((await query<{ user_id: string | null }>("SELECT user_id FROM wl.employees WHERE id=$1", [otherProfile]))[0].user_id, null);

    const owner = await createAccount("owner");
    const ownerActor = { ...actor, user_id: owner.id, role: "owner" } as Session;
    const oldProfile = randomUUID();
    await query("INSERT INTO wl.employees(id,name,email,hourly_rate_cents) VALUES($1,'Existing hire','legacy-hire@example.test',4200)", [oldProfile]);
    const created = await adminAction("save_user", { name: "Existing hire", email: " LEGACY-HIRE@example.test ", password, phone: "3125550170", position: "Detailer", role: "staff", active: true }, ownerActor) as { id: string };
    assert.deepEqual(await query("SELECT id,hourly_rate_cents FROM wl.employees WHERE user_id=$1", [created.id]), [{ id: oldProfile, hourly_rate_cents: 4200 }]);
    await assert.rejects(adminAction("save_user", { name: "Duplicate hire", email: "legacy-hire@example.test", password, phone: "3125550170", role: "staff" }, ownerActor), /already uses this email/);
  } finally { await closeDatabase(); }
});


test("native form sign-in works before hydration without putting credentials in a URL", async () => {
  try {
    const account = await createAccount("staff");
    const submit = (value: string) => signIn(new Request("https://example.test/api/admin/login", {
      method: "POST", headers: { Origin: "https://example.test", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: account.email, password: value }).toString(),
    }));
    const success = await submit(password);
    assert.equal(success.status, 303);
    assert.equal(success.headers.get("location"), "/admin/my_schedule");
    assert.match(success.headers.get("set-cookie")!, /wl_session=/);
    const failure = await submit("incorrect");
    assert.equal(failure.status, 303);
    assert.equal(failure.headers.get("location"), "/admin/login?error=credentials");
    assert.equal(failure.headers.get("set-cookie"), null);
    for (const response of [success, failure]) {
      assert.ok(!response.headers.get("location")?.includes(account.email));
      assert.ok(!response.headers.get("location")?.includes(password));
    }
  } finally { await closeDatabase(); }
});

test("native password reset preserves its token on errors and redirects to sign-in after success", async () => {
  try {
    const account = await createAccount("staff");
    const token = (await createReset(account.email, "native-reset-fixture"))!;
    const submit = (value: string) => requestReset(new Request("https://example.test/api/admin/reset", {
      method: "POST", headers: { Origin: "https://example.test", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token, password: value }).toString(),
    }));
    const failed = await submit("short");
    assert.equal(failed.status, 303);
    assert.equal(failed.headers.get("location"), `/admin/reset?token=${token}&error=invalid`);
    const updatedPassword = password + "-reset";
    const success = await submit(updatedPassword);
    assert.equal(success.status, 303);
    assert.equal(success.headers.get("location"), "/admin/login?reset=complete");
    assert.ok(await sessionFromToken(await login(account.email, updatedPassword, "native-reset-login")));
    const reused = await submit(password);
    assert.equal(reused.headers.get("location"), `/admin/reset?token=${token}&error=invalid`);
  } finally { await closeDatabase(); }
});
