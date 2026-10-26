import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { GET, POST } from "../app/api/admin/employee-resources/route";
import { createEmployeeAccessLink, employeeResourceData, saveEmployeeResource, archiveEmployeeResource } from "../lib/platform/employee-resources";
import { hash, login, passwordHash, resetPassword, sessionFromToken } from "../lib/platform/auth";
import { closeDatabase, query } from "../lib/platform/db";
import type { Role, Session } from "../lib/platform/types";

Object.assign(process.env, { NODE_ENV: "test", PGLITE_PATH: "memory://employee-resources", NEXT_PUBLIC_SITE_URL: "https://example.test" });
for (const key of ["DATABASE_URL", "RAILWAY_ENVIRONMENT", "ADMIN_EMAIL", "ADMIN_PASSWORD", "RESEND_API_KEY", "EMAIL_PROVIDER_API_KEY", "TELEGRAM_BOT_TOKEN", "TWILIO_AUTH_TOKEN", "SQUARE_ACCESS_TOKEN"])
  delete process.env[key];
const password = "Employee-resource-test-2026";
async function person(role: Role, name: string) {
  const userId = randomUUID(), employeeId = randomUUID(), email = `${randomUUID()}@example.test`, token = randomBytes(32).toString("hex");
  await query("INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)", [userId, name, email, passwordHash(password), role]);
  await query("INSERT INTO wl.employees(id,user_id,name,email) VALUES($1,$2,$3,$4)", [employeeId, userId, name, email]);
  await query("INSERT INTO wl.sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')", [hash(token), userId]);
  const user: Session = { id: hash(token), user_id: userId, name, email, role };
  return { user, employeeId, cookie: `wl_session=${token}` };
}
function request(cookie: string, action: string, data: unknown, origin = "https://example.test") {
  return new Request("https://example.test/api/admin/employee-resources", { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ action, data }) });
}
const resource = { title: "Interior detailing checklist", kind: "checklist", url: "https://example.test/files/checklist.pdf", description: "Before handing the car back to the customer." };

test("employee resources keep personal contracts private and reject forbidden edits and links", async () => {
  try {
    const owner = await person("owner", "Owner"), manager = await person("manager", "Manager"), first = await person("staff", "First worker"), second = await person("staff", "Second worker");
    const shared = await saveEmployeeResource(resource, manager.user);
    const personal = await saveEmployeeResource({ ...resource, title: "First worker contract", kind: "contract", employee_id: first.employeeId }, manager.user);
    await saveEmployeeResource({ ...resource, title: "Second worker contract", kind: "contract", employee_id: second.employeeId }, owner.user);
    const ownerContract = await saveEmployeeResource({ ...resource, title: "Owner document", kind: "contract", employee_id: owner.employeeId }, owner.user);
    const firstData = await employeeResourceData(first.user);
    assert.deepEqual(new Set(firstData.resources.map(r => r.id)), new Set([shared.id, personal.id]));
    assert.equal(firstData.employees.length, 0);
    assert.equal(firstData.resources.some(r => r.can_edit), false);
    assert.equal(firstData.login_email, first.user.email);
    assert.equal((await employeeResourceData(manager.user, true)).resources.some(r => r.id === ownerContract.id), false);
    assert.equal((await employeeResourceData(owner.user, true)).resources.length, 4);
    await assert.rejects(saveEmployeeResource({ ...resource, kind: "contract" }, owner.user), /Contracts must be assigned/);
    await assert.rejects(saveEmployeeResource({ ...resource, id: personal.id, kind: "document", employee_id: null }, owner.user), /Keep this contract assigned/);
    await assert.rejects(saveEmployeeResource({ ...resource, id: ownerContract.id, employee_id: first.employeeId }, manager.user), /cannot manage this employee/);
    await assert.rejects(archiveEmployeeResource({ id: ownerContract.id }, manager.user), /cannot manage this employee/);
    await assert.rejects(employeeResourceData(first.user, true), /Only managers/);
    for (const url of ["not a link", "javascript:alert(1)", "data:text/html,hello", "https://username:password@example.test/private.pdf"])
      await assert.rejects(saveEmployeeResource({ ...resource, url }, owner.user), /http or https|valid link/);
    assert.equal((await GET(new Request("https://example.test/api/admin/employee-resources"))).status, 401);
    const allowed = await GET(new Request("https://example.test/api/admin/employee-resources", { headers: { Cookie: first.cookie } }));
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("Cache-Control"), "private, no-store");
    assert.equal((await allowed.json()).resources.length, 2);
    assert.equal((await GET(new Request("https://example.test/api/admin/employee-resources?manage=1", { headers: { Cookie: first.cookie } }))).status, 403);
    assert.equal((await POST(request(first.cookie, "save", resource))).status, 403);
    assert.equal((await POST(request(manager.cookie, "save", resource, "https://attacker.example"))).status, 403);
    await archiveEmployeeResource({ id: personal.id }, manager.user);
    assert.deepEqual((await employeeResourceData(first.user)).resources.map(r => r.id), [shared.id]);
    assert.equal((await employeeResourceData(manager.user, true)).resources.find(r => r.id === personal.id)?.active, false);
  } finally { await closeDatabase(); }
});

test("employee password setup uses one-time hashed links and cannot reset privileged accounts", async () => {
  try {
    const owner = await person("owner", "Owner"), manager = await person("manager", "Manager"), worker = await person("staff", "Worker");
    const originalSession = await login(worker.user.email, password, "before-setup");
    const first = await createEmployeeAccessLink({ employee_id: worker.employeeId }, manager.user);
    const firstToken = new URL(first.url).searchParams.get("token")!;
    assert.equal(first.email, worker.user.email);
    assert.equal(first.login_url, "https://example.test/admin/login");
    assert.equal(first.created_login, false);
    assert.ok(new Date(first.expires_at).getTime() > Date.now());
    assert.ok(await sessionFromToken(await login(worker.user.email, password, "existing-password")));
    const saved = await query<{ token_hash: string }>("SELECT token_hash FROM wl.password_resets WHERE user_id=$1", [worker.user.user_id]);
    assert.equal(saved[0].token_hash, hash(firstToken));
    assert.notEqual(saved[0].token_hash, firstToken);
    const second = await createEmployeeAccessLink({ employee_id: worker.employeeId }, manager.user);
    const secondToken = new URL(second.url).searchParams.get("token")!;
    await assert.rejects(resetPassword(firstToken, password + "-new"), /invalid or expired/);
    await resetPassword(secondToken, password + "-new");
    assert.equal(await sessionFromToken(originalSession), null);
    assert.ok(await sessionFromToken(await login(worker.user.email, password + "-new", "new-password")));
    await assert.rejects(resetPassword(secondToken, password + "-again"), /invalid or expired/);
    await assert.rejects(createEmployeeAccessLink({ employee_id: owner.employeeId }, manager.user), /cannot manage this employee/);
    await assert.rejects(createEmployeeAccessLink({ employee_id: worker.employeeId }, worker.user), /Only managers/);
    await query("UPDATE wl.employees SET active=false WHERE id=$1", [worker.employeeId]);
    await assert.rejects(createEmployeeAccessLink({ employee_id: worker.employeeId }, manager.user), /inactive/);
    const audit = await query<{ after_data: unknown }>("SELECT after_data FROM wl.audit_logs WHERE entity_id=$1", [worker.employeeId]);
    assert.equal(JSON.stringify(audit).includes(secondToken), false);
    assert.equal((await query("SELECT id FROM wl.messages")).length, 0, "No setup emails are sent automatically");
  } finally { await closeDatabase(); }
});

test("missing employee logins are provisioned without taking another employee's account", async () => {
  try {
    const manager = await person("manager", "Manager"), existing = await person("staff", "Existing worker");
    const employeeId = randomUUID(), email = `${randomUUID()}@example.test`;
    await query("INSERT INTO wl.employees(id,name,email) VALUES($1,'New hire',$2)", [employeeId, email]);
    const created = await createEmployeeAccessLink({ employee_id: employeeId }, manager.user);
    assert.equal(created.created_login, true);
    assert.equal(created.email, email);
    const account = (await query<{ role: string; user_id: string }>("SELECT u.role,e.user_id FROM wl.employees e JOIN wl.users u ON u.id=e.user_id WHERE e.id=$1", [employeeId]))[0];
    assert.equal(account.role, "staff");
    const token = new URL(created.url).searchParams.get("token")!;
    await resetPassword(token, password);
    const session = await sessionFromToken(await login(email, password, "provisioned"));
    assert.equal(session?.user_id, account.user_id);
    assert.equal((await employeeResourceData(session!)).login_email, email);
    const duplicate = randomUUID();
    await query("INSERT INTO wl.employees(id,name,email) VALUES($1,'Duplicate profile',$2)", [duplicate, existing.user.email]);
    await assert.rejects(createEmployeeAccessLink({ employee_id: duplicate }, manager.user), /already belongs to another/);
    assert.equal((await query<{ user_id: string | null }>("SELECT user_id FROM wl.employees WHERE id=$1", [duplicate]))[0].user_id, null);
    await query("UPDATE wl.users SET active=false WHERE id=$1", [account.user_id]);
    await assert.rejects(createEmployeeAccessLink({ employee_id: employeeId }, manager.user), /inactive/);
  } finally { await closeDatabase(); }
});
