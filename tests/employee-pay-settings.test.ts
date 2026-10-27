import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { GET } from "../app/api/admin/employee-pay-settings/route";
import { employeePaySettings } from "../lib/platform/employee-pay-settings";
import { closeDatabase, query } from "../lib/platform/db";
import { hash } from "../lib/platform/auth";
import type { Role, Session } from "../lib/platform/types";

Object.assign(process.env, { NODE_ENV: "test", PGLITE_PATH: "memory://employee-pay-settings" });
delete process.env.DATABASE_URL;
delete process.env.RAILWAY_ENVIRONMENT;

async function login(role: Role) {
  const id = randomUUID(), token = randomBytes(32).toString("hex"), email = `${id}@example.test`;
  await query("INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,'Pay manager',$2,'test',$3)", [id, email, role]);
  await query("INSERT INTO wl.sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')", [hash(token), id]);
  return { cookie: `wl_session=${token}`, user: { id: hash(token), user_id: id, name: "Pay manager", email, role } satisfies Session };
}

test("pay settings include all plans and historical rules without mutating them", async () => {
  try {
    const manager = await login("manager"), employee = randomUUID();
    await query("INSERT INTO wl.employees(id,name,position,active,compensation_model,default_commission_bps) VALUES($1,'Former worker','Detailer',false,'commission',4000)", [employee]);
    const services = await query<{ id: string }>("SELECT id FROM wl.services ORDER BY id LIMIT 2");
    await query("UPDATE wl.services SET active=false WHERE id=ANY($1::uuid[])", [services.map(service => service.id)]);
    const rule = randomUUID();
    await query("INSERT INTO wl.employee_pay_rules(id,employee_id,service_id,rule_type,value,active) VALUES($1,$2,$3,'commission_percent',2000,false)", [rule, employee, services[0].id]);
    const before = await query("SELECT * FROM wl.employee_pay_rules WHERE id=$1", [rule]);
    const result = await employeePaySettings(manager.user);
    assert.equal(result.employees.find(row => row.id === employee)?.active, false);
    assert.ok(result.services.some(row => row.id === services[0].id));
    assert.ok(!result.services.some(row => row.id === services[1].id));
    const saved = result.rules.find(row => row.id === rule)!;
    assert.equal(saved.active, false);
    assert.equal(saved.value, 2000);
    assert.equal(saved.employee_name, "Former worker");
    assert.match(saved.updated_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(await query("SELECT * FROM wl.employee_pay_rules WHERE id=$1", [rule]), before);
    const response = await GET(new Request("http://localhost/api/admin/employee-pay-settings", { headers: { cookie: manager.cookie } }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal((await response.json()).ok, true);
  } finally { await closeDatabase(); }
});

test("employee pay settings reject signed-out and staff callers", async () => {
  try {
    const staff = await login("staff");
    assert.equal((await GET(new Request("http://localhost/api/admin/employee-pay-settings"))).status, 401);
    assert.equal((await GET(new Request("http://localhost/api/admin/employee-pay-settings", { headers: { cookie: staff.cookie } }))).status, 403);
    await assert.rejects(employeePaySettings(staff.user), /does not have access/);
  } finally { await closeDatabase(); }
});
