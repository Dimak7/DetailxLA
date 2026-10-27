import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database, query, closeDatabase } from "../lib/platform/db";
import { adminAction } from "../lib/platform/admin";
import { payrollSummary } from "../lib/platform/payroll";
import type { Session } from "../lib/platform/types";

process.env.PGLITE_PATH = "memory://pay-rule-preservation";
Object.assign(process.env, { NODE_ENV: "test" });
delete process.env.DATABASE_URL;
delete process.env.RAILWAY_ENVIRONMENT;

const actor: Session = { id: randomUUID(), user_id: randomUUID(), name: "Pay manager", email: "pay-manager@example.test", role: "manager" };
const customer = randomUUID(), vehicle = randomUUID();
let service: string;
before(async () => {
  await database();
  await query("INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,$2,$3,'fixture','manager')", [actor.user_id,actor.name,actor.email]);
  await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone) VALUES($1,'Pay','Fixture','pay-fixture@example.test','')", [customer]);
  await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Test','Coupe',2026,'Sedan')", [vehicle,customer]);
  service = (await query<{id:string}>("SELECT id FROM wl.services ORDER BY id LIMIT 1"))[0].id;
});
after(closeDatabase);

async function employee(bps = 4000) {
  const id = randomUUID();
  await query("INSERT INTO wl.employees(id,name,position,compensation_model,default_commission_bps) VALUES($1,$2,'Detailer','commission',$3)", [id,`Worker ${id}`,bps]);
  return id;
}
async function job(employeeId: string, status = "completed") {
  const id = randomUUID();
  await query(`INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,status,price_cents,tip_cents)
    VALUES($1::uuid,$1::text,'fixture',$1::text,$2,$3,$4,'Detail','{}','2026-10-26',600,60,$5,20000,1500)`, [id,customer,vehicle,service,status]);
  await query("INSERT INTO wl.employee_job_assignments(id,booking_id,employee_id,pool_share_bps) VALUES($1,$2,$3,10000)", [randomUUID(),id,employeeId]);
  return id;
}
async function pay(employeeId: string, bookingId: string) {
  const row = (await payrollSummary("2026-10-26","2026-10-26",undefined,bookingId)).find(row => row.id === employeeId)!;
  return Number(row.commission_cents);
}
async function snapshot(bookingId: string) {
  return (await query<{commission_override_cents:number|null}>("SELECT commission_override_cents FROM wl.employee_job_assignments WHERE booking_id=$1", [bookingId]))[0].commission_override_cents;
}
async function save(employeeId: string, extra: Record<string, unknown> = {}) {
  return await adminAction("save_pay_rule", { employee_id:employeeId,service_id:service,rule_type:"commission_percent",value:2000,active:true,...extra },actor) as {id:string};
}

test("a new preserved service rule keeps completed earnings and applies to future completions", async () => {
  const id = await employee(), completed = await job(id), future = await job(id,"confirmed");
  const period = randomUUID(), record = randomUUID();
  await query("INSERT INTO wl.pay_periods(id,start_date,end_date,status) VALUES($1,'2026-10-26','2026-10-26','paid')",[period]);
  await query("INSERT INTO wl.payroll_records(id,pay_period_id,employee_id,hourly_rate_cents,estimated_gross_cents) VALUES($1,$2,$3,0,12345)",[record,period,id]);
  const paidBefore = await query("SELECT * FROM wl.payroll_records WHERE id=$1",[record]);
  await save(id,{preserve_completed:true});
  assert.equal(await pay(id,completed),8000);
  assert.equal(await snapshot(completed),8000);
  assert.equal(await snapshot(future),null);
  await query("UPDATE wl.bookings SET status='completed' WHERE id=$1",[future]);
  assert.equal(await pay(id,future),4000);
  assert.deepEqual(await query("SELECT * FROM wl.payroll_records WHERE id=$1",[record]),paidBefore);
});

test("unchanged rules do not snapshot; changing a rate preserves the prior earned amount", async () => {
  const id = await employee(), rule = await save(id), completed = await job(id), future = await job(id,"confirmed");
  await save(id,{id:rule.id,preserve_completed:true});
  assert.equal(await snapshot(completed),null,"no-op save must not freeze a newly completed estimate");
  await save(id,{id:rule.id,value:5000,preserve_completed:true});
  assert.equal(await pay(id,completed),4000);
  await query("UPDATE wl.bookings SET status='completed' WHERE id=$1",[future]);
  assert.equal(await pay(id,future),10000);
});

test("removing or disabling a rule preserves completed pay while future work uses the fallback", async () => {
  for (const mode of ["remove","disable"] as const) {
    const id = await employee(), rule = await save(id), completed = await job(id), future = await job(id,"confirmed");
    if (mode === "remove") await adminAction("remove_pay_rule",{id:rule.id,preserve_completed:true},actor);
    else await save(id,{id:rule.id,active:false,preserve_completed:true});
    assert.equal(await pay(id,completed),4000);
    assert.equal(await snapshot(completed),4000);
    await query("UPDATE wl.bookings SET status='completed' WHERE id=$1",[future]);
    assert.equal(await pay(id,future),8000);
  }
});

test("omitting preserve_completed keeps legacy recalculation behavior", async () => {
  const id = await employee(), completed = await job(id);
  const rule = await save(id);
  assert.equal(await snapshot(completed),null);
  assert.equal(await pay(id,completed),4000);
  await adminAction("remove_pay_rule",{id:rule.id},actor);
  assert.equal(await snapshot(completed),null);
  assert.equal(await pay(id,completed),8000);
});

test("moving a rule preserves both employees and invalid edits leave no snapshots", async () => {
  const first = await employee(), second = await employee(3000), rule = await save(first);
  const firstJob = await job(first), secondJob = await job(second);
  await assert.rejects(save(first,{id:rule.id,service_id:randomUUID(),preserve_completed:true}),/Service not found/);
  assert.equal(await snapshot(firstJob),null);
  await save(second,{id:rule.id,preserve_completed:true});
  assert.equal(await pay(first,firstJob),4000);
  assert.equal(await pay(second,secondJob),6000);
  const firstFuture = await job(first), secondFuture = await job(second);
  assert.equal(await pay(first,firstFuture),8000);
  assert.equal(await pay(second,secondFuture),4000);
});
