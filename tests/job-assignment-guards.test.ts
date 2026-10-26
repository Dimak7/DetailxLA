import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { saveJobCompensation } from "../lib/platform/job-compensation";
import { query, closeDatabase } from "../lib/platform/db";

Object.assign(process.env, { NODE_ENV: "test", PGLITE_PATH: "memory://job-assignment-guards" });
delete process.env.DATABASE_URL;
delete process.env.RAILWAY_ENVIRONMENT;
delete process.env.ADMIN_EMAIL;
delete process.env.ADMIN_PASSWORD;
const date = "2026-11-05";
async function fixture() {
  const actor = randomUUID(), customer = randomUUID(), vehicle = randomUUID();
  const service = (await query<{ id: string }>("SELECT id FROM wl.services ORDER BY id LIMIT 1"))[0].id;
  await query("INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,'Manager',$2,'fixture','manager')", [actor, `${actor}@example.test`]);
  await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone) VALUES($1,'Assignment','Fixture',$2,'')", [customer, `${customer}@example.test`]);
  await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Test','Car',2026,'Sedan')", [vehicle, customer]);
  async function booking(start = 600, status = "new") {
    const id = randomUUID();
    await query(`INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,status,price_cents)
      VALUES($1::uuid,$1::text,'fixture',$1::text,$2,$3,$4,'Detail','{}',$5,$6,60,$7,2500)`, [id, customer, vehicle, service, date, start, status]);
    return id;
  }
  async function employee(linked = false) {
    const id = randomUUID(), user = linked ? randomUUID() : null;
    if (user) await query("INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,'Detailer',$2,'fixture','staff')", [user, `${user}@example.test`]);
    await query("INSERT INTO wl.employees(id,user_id,name) VALUES($1,$2,'Detailer')", [id, user]);
    return { id, user };
  }
  return { actor, booking, employee };
}
const assignment = (employee_id: string) => ({ employee_id, pool_share_bps: 10000, pay_type: "percentage", pay_value: 4000 });

test("new assignments require schedule review, overrides are audited and existing pay edits remain possible", async () => {
  try {
    const f = await fixture(), worker = await f.employee(), job = await f.booking();
    const input = { booking_id: job, assignments: [assignment(worker.id)] };
    await assert.rejects(saveJobCompensation(input, f.actor), /not scheduled.*manager override/);
    assert.equal((await query("SELECT id FROM wl.employee_job_assignments")).length, 0);
    await saveJobCompensation({ ...input, assignment_override: true }, f.actor);
    const audit = await query<{ after_data: { warnings: string[]; employee_ids: string[] } }>("SELECT after_data FROM wl.audit_logs WHERE entity_id=$1 AND action='assignment_override'", [job]);
    assert.equal(audit.length, 1);
    assert.deepEqual(audit[0].after_data.employee_ids, [worker.id]);
    assert.match(audit[0].after_data.warnings[0], /not scheduled/);
    await query("INSERT INTO wl.employee_shifts(id,employee_id,shift_date,start_minute,end_minute,status) VALUES($1,$2,$3,0,1440,'pto')", [randomUUID(), worker.id, date]);
    await saveJobCompensation({ ...input, assignments: [{ ...assignment(worker.id), pay_value: 5000 }] }, f.actor);
    assert.equal((await query<{ pay_value: number }>("SELECT pay_value FROM wl.employee_job_assignments WHERE booking_id=$1", [job]))[0].pay_value, 5000, "Editing pay on an existing assignment does not reassign the job");
    assert.equal((await query("SELECT id FROM wl.audit_logs WHERE entity_id=$1 AND action='assignment_override'", [job])).length, 1);
  } finally { await closeDatabase(); }
});

test("shared assignments block overlap and dated time off overrides recurring availability", async () => {
  try {
    const f = await fixture(), worker = await f.employee(true), job = await f.booking(), next = await f.booking(630);
    await query("INSERT INTO wl.employee_availability(employee_id,weekday,start_minute,end_minute,available) VALUES($1,4,480,1200,true)", [worker.id]);
    await saveJobCompensation({ booking_id: job, assignments: [assignment(worker.id)] }, f.actor);
    await query("UPDATE wl.bookings SET assigned_to=NULL WHERE id=$1", [job]);
    await assert.rejects(saveJobCompensation({ booking_id: next, assignments: [assignment(worker.id)] }, f.actor), /already assigned/);
    assert.equal((await query("SELECT id FROM wl.employee_job_assignments WHERE booking_id=$1", [next])).length, 0);
    await query("UPDATE wl.bookings SET status='cancelled' WHERE id=$1", [job]);
    await query("INSERT INTO wl.employee_shifts(id,employee_id,shift_date,start_minute,end_minute,status) VALUES($1,$2,$3,0,1440,'pto')", [randomUUID(), worker.id, date]);
    await assert.rejects(saveJobCompensation({ booking_id: next, assignments: [assignment(worker.id)] }, f.actor), /PTO date override/);
    await query("UPDATE wl.employee_shifts SET status='scheduled',start_minute=600,end_minute=660 WHERE employee_id=$1", [worker.id]);
    await assert.rejects(saveJobCompensation({ booking_id: next, assignments: [assignment(worker.id)] }, f.actor), /full job hours/);
    await query("UPDATE wl.employee_shifts SET end_minute=720 WHERE employee_id=$1", [worker.id]);
    await saveJobCompensation({ booking_id: next, assignments: [assignment(worker.id)] }, f.actor);
    assert.equal((await query<{ assigned_to: string }>("SELECT assigned_to FROM wl.bookings WHERE id=$1", [next]))[0].assigned_to, worker.user);
  } finally { await closeDatabase(); }
});

test("inactive linked logins and cancelled jobs cannot be assigned through a manager override", async () => {
  try {
    const f = await fixture(), worker = await f.employee(true), job = await f.booking(), cancelled = await f.booking(720, "cancelled");
    const input = { booking_id: job, assignment_override: true, assignments: [assignment(worker.id)] };
    await query("UPDATE wl.users SET active=false WHERE id=$1", [worker.user]);
    await assert.rejects(saveJobCompensation(input, f.actor), /active team members/);
    await query("UPDATE wl.users SET active=true,removed_at=now() WHERE id=$1", [worker.user]);
    await assert.rejects(saveJobCompensation(input, f.actor), /active team members/);
    await query("UPDATE wl.users SET removed_at=NULL WHERE id=$1", [worker.user]);
    await assert.rejects(saveJobCompensation({ ...input, booking_id: cancelled }, f.actor), /Reopen this job/);
    assert.equal((await query("SELECT id FROM wl.employee_job_assignments")).length, 0);
  } finally { await closeDatabase(); }
});
