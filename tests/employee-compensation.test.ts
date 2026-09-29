import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { database, query, closeDatabase } from "../lib/platform/db";
import { schema } from "../lib/platform/schema";
import { payrollSummary } from "../lib/platform/payroll";
import { adminAction, adminData } from "../lib/platform/admin";
import type { Row, Session } from "../lib/platform/types";

process.env.PGLITE_PATH = "memory://employee-compensation";
Object.assign(process.env, { NODE_ENV: "test" });
delete process.env.DATABASE_URL;
delete process.env.RAILWAY_ENVIRONMENT;

test("legacy compensation migration preserves effective pay once and never rewrites paid snapshots", async () => {
  const db = await PGlite.create();
  try {
    // Install the real previous schema, then apply the production migration twice.
    await db.exec(schema.slice(0, schema.indexOf("-- Preserve the old effective plan once")));
    const detailer = randomUUID(), hourly = randomUUID(), commission = randomUUID(), flat = randomUUID();
    await db.query(`INSERT INTO wl.employees(id,name,position,hourly_rate_cents,compensation_model,default_commission_bps,flat_job_pay_cents)
      VALUES($1,'Legacy detailer','Detailer',9900,'flat_job',9900,7000),
      ($2,'Hourly','Manager',2500,'hourly',2000,5000),
      ($3,'Commission','Manager',0,'commission',1500,6000),
      ($4,'Flat','Manager',0,'flat_job',2000,8000)`, [detailer,hourly,commission,flat]);
    const rules = [detailer,hourly,commission,flat].flatMap((employee_id) =>
      ["commission_percent", "flat_job"].map((rule_type) => ({ id: randomUUID(), employee_id, rule_type })),
    );
    for (const rule of rules) await db.query("INSERT INTO wl.employee_pay_rules(id,employee_id,rule_type,value) VALUES($1,$2,$3,4000)", [rule.id,rule.employee_id,rule.rule_type]);
    const period = randomUUID(), record = randomUUID();
    await db.query("INSERT INTO wl.pay_periods(id,start_date,end_date,status) VALUES($1,'2026-08-01','2026-08-07','paid')", [period]);
    await db.query("INSERT INTO wl.payroll_records(id,pay_period_id,employee_id,hourly_rate_cents,estimated_gross_cents,approved_at) VALUES($1,$2,$3,1000,12345,now())", [record,period,detailer]);
    const snapshot = (await db.query("SELECT * FROM wl.payroll_records")).rows;
    await db.exec(schema);
    assert.deepEqual((await db.query("SELECT hourly_rate_cents,compensation_model,default_commission_bps,flat_job_pay_cents FROM wl.employees WHERE id=$1", [detailer])).rows, [
      { hourly_rate_cents: 1000, compensation_model: "hourly_commission", default_commission_bps: 3000, flat_job_pay_cents: 7000 },
    ]);
    for (const rule of rules) {
      const expectedActive = (rule.employee_id === commission && rule.rule_type === "commission_percent")
        || (rule.employee_id === flat && rule.rule_type === "flat_job");
      assert.equal((await db.query<{active:boolean}>("SELECT active FROM wl.employee_pay_rules WHERE id=$1", [rule.id])).rows[0].active, expectedActive);
    }
    assert.deepEqual((await db.query("SELECT hourly_rate_cents,compensation_model,default_commission_bps,flat_job_pay_cents FROM wl.employees WHERE id=$1", [hourly])).rows, [
      { hourly_rate_cents: 2500, compensation_model: "hourly", default_commission_bps: 2000, flat_job_pay_cents: 5000 },
    ]);
    await db.query("UPDATE wl.employees SET hourly_rate_cents=2200,compensation_model='commission',default_commission_bps=4200 WHERE id=$1", [detailer]);
    await db.query("UPDATE wl.employee_pay_rules SET active=true WHERE id=$1", [rules[0].id]);
    await db.exec(schema);
    assert.deepEqual((await db.query("SELECT hourly_rate_cents,compensation_model,default_commission_bps FROM wl.employees WHERE id=$1", [detailer])).rows, [
      { hourly_rate_cents: 2200, compensation_model: "commission", default_commission_bps: 4200 },
    ]);
    assert.equal((await db.query<{active:boolean}>("SELECT active FROM wl.employee_pay_rules WHERE id=$1", [rules[0].id])).rows[0].active, true);
    assert.deepEqual((await db.query("SELECT * FROM wl.payroll_records")).rows, snapshot);
    assert.equal((await db.query<{count:number}>("SELECT count(*)::int count FROM wl.migrations WHERE version=3")).rows[0].count, 1);
  } finally { await db.close(); }
});

test("manager compensation actions honor custom defaults, mixed service rules, assignment overrides and paid history", async (t) => {
  try {
    await database();
    const roles = ["owner", "admin", "manager", "staff"] as const;
    const sessions = {} as Record<typeof roles[number], Session>;
    for (const role of roles) {
      const user_id = randomUUID();
      sessions[role] = { id: randomUUID(), user_id, name: `Pay ${role}`, email: `${user_id}@example.test`, role };
      await query("INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,$2,$3,'fixture',$4)", [user_id,sessions[role].name,sessions[role].email,role]);
    }
    const services = await query<{id:string}>("SELECT id FROM wl.services ORDER BY id LIMIT 3");
    assert.equal(services.length, 3);
    const customer = randomUUID(), vehicle = randomUUID();
    await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone) VALUES($1,'Pay','Fixture',$2,'')", [customer,`${customer}@example.test`]);
    await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Test','Coupe',2026,'Sedan')", [vehicle,customer]);
    const employee = async (name:string) => {
      const id = randomUUID();
      await query("INSERT INTO wl.employees(id,name,position) VALUES($1,$2,'Detailer')", [id,name]);
      return id;
    };
    const job = async (employeeId:string, service = services[0].id, price = 20000, tips = 2000, date = "2026-09-29") => {
      const id = randomUUID();
      await query(`INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,
        service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,status,price_cents,tip_cents)
        VALUES($1::uuid,$1::text,'fixture',$1::text,$2,$3,$4,'Detail','{}',$5,600,60,'completed',$6,$7)`, [id,customer,vehicle,service,date,price,tips]);
      await query("INSERT INTO wl.employee_job_assignments(id,booking_id,employee_id,pool_share_bps) VALUES($1,$2,$3,10000)", [randomUUID(),id,employeeId]);
      return id;
    };
    const hours = (id:string) => query("INSERT INTO wl.time_entries(id,employee_id,clock_in,clock_out) VALUES($1,$2,'2026-09-29T14:00:00Z','2026-09-29T16:00:00Z')", [randomUUID(),id]);
    const summary = async (id:string) => (await payrollSummary("2026-09-29","2026-09-29")).find((row) => row.id === id)!;
    const plan = (employee_id:string, compensation_model:string, hourly_rate_cents=0, default_commission_bps=0, flat_job_pay_cents=0) => ({ employee_id, compensation_model, hourly_rate_cents, default_commission_bps, flat_job_pay_cents });
    const save = (input:ReturnType<typeof plan>, actor = sessions.manager) => adminAction("save_employee_compensation",input,actor);

    const percentEmployee = await employee("Custom percentage");
    await save(plan(percentEmployee,"commission",9900,3750), sessions.owner);
    const percentJob = await job(percentEmployee);
    await hours(percentEmployee);
    await query("INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,status,kind) VALUES($1,$2,$3,2000,'paid','deposit')", [randomUUID(),percentJob,customer]);
    let row = await summary(percentEmployee);
    assert.equal(Number(row.commission_cents),7500);
    assert.equal(Number(row.hourly_earnings_cents),0);
    assert.equal(Number(row.tips_cents),2000);
    assert.equal(Number(row.total_earnings_cents),9500);
    t.diagnostic("Detailer percentage is configurable and uses final service price, not partial collection or tips");

    const flatEmployee = await employee("Custom flat"), partner = await employee("Shared job partner");
    await save(plan(flatEmployee,"flat_job",9900,9999,9000), sessions.admin);
    await save(plan(partner,"commission",0,1000));
    const sharedJob = await job(flatEmployee);
    await hours(flatEmployee);
    await adminAction("save_job_assignments", { booking_id: sharedJob, assignments: [
      { employee_id:flatEmployee,pool_share_bps:2500 }, { employee_id:partner,pool_share_bps:7500 },
    ] },sessions.manager);
    row = await summary(flatEmployee);
    assert.equal(Number(row.commission_cents),2250);
    assert.equal(Number(row.hourly_earnings_cents),0);
    assert.equal(Number(row.tips_cents),1000);
    assert.equal(Number((await summary(partner)).commission_cents),1500);
    t.diagnostic("employee flat job pay and partner percentage each receive their share exactly once");

    const combined = await employee("Custom hourly plus commission");
    await save(plan(combined,"hourly_commission",1750,2250));
    await job(combined);
    await hours(combined);
    row = await summary(combined);
    assert.equal(Number(row.hourly_earnings_cents),3500);
    assert.equal(Number(row.commission_cents),4500);
    assert.equal(Number(row.total_earnings_cents),10000);
    assert.equal(row.compensation_model,"hourly_commission");
    assert.equal(Number(row.hourly_rate_cents),1750);
    t.diagnostic("custom Detailer hourly plus percentage replaces both former fixed rates");

    const mixed = await employee("Hourly with mixed service overrides");
    await save(plan(mixed,"hourly",2000,7000,9999));
    await job(mixed,services[0].id,20000,0);
    const mixedFlatJob = await job(mixed,services[1].id,30000,0);
    await job(mixed,services[2].id,40000,0);
    await hours(mixed);
    assert.equal(Number((await summary(mixed)).commission_cents),0, "hourly-only defaults ignore dormant job-rate values");
    const rule = (service_id:string|null, rule_type:string, value:number) => ({ employee_id:mixed,service_id,rule_type,value,active:true });
    const generalRule = await adminAction("save_pay_rule",rule(null,"commission_percent",1250),sessions.manager) as {id:string};
    const exactRule = await adminAction("save_pay_rule",rule(services[0].id,"commission_percent",4000),sessions.manager) as {id:string};
    await adminAction("save_pay_rule",rule(services[1].id,"flat_job",8000),sessions.manager);
    row = await summary(mixed);
    assert.equal(Number(row.commission_cents),21000, "$80 exact percentage + $80 exact flat + $50 all-services percentage");
    assert.equal(Number(row.hourly_earnings_cents),4000);
    await save(plan(mixed,"flat_job",2000,0,9999));
    assert.equal(Number((await summary(mixed)).commission_cents),21000, "mixed rules remain applicable when the default model changes");
    const replacement = await adminAction("save_pay_rule",rule(services[0].id,"flat_job",5000),sessions.manager) as {id:string};
    assert.equal((await query<{active:boolean}>("SELECT active FROM wl.employee_pay_rules WHERE id=$1", [exactRule.id]))[0].active,false);
    assert.equal(Number((await summary(mixed)).commission_cents),18000);
    const audit = (await query<{after_data:{replaced_rule_ids:string[]}}>("SELECT after_data FROM wl.audit_logs WHERE entity_type='employee_pay_rule' AND entity_id=$1 ORDER BY created_at DESC LIMIT 1", [replacement.id]))[0];
    assert.deepEqual(audit.after_data.replaced_rule_ids,[exactRule.id]);
    await adminAction("save_pay_rule",{ ...rule(services[0].id,"flat_job",5000),id:replacement.id,active:false },sessions.manager);
    assert.equal(Number((await summary(mixed)).commission_cents),15500, "disabling a service rule falls back to the all-services rate");
    await adminAction("save_pay_rule",{ ...rule(null,"commission_percent",1250),id:generalRule.id,active:false },sessions.manager);
    assert.equal(Number((await summary(mixed)).commission_cents),27998, "no active rule falls back to the flat employee default");
    t.diagnostic("service percent and flat rules override any default model; replacing a rule leaves only one active per scope");

    await adminAction("assign_job_employee", { booking_id:mixedFlatJob,employee_id:mixed,pool_share_bps:2500,commission_override_cents:4321 },sessions.manager);
    await adminAction("save_job_assignments", { booking_id:mixedFlatJob,assignments:[
      { employee_id:mixed,pool_share_bps:2500 },{ employee_id:partner,pool_share_bps:7500 },
    ] },sessions.manager);
    assert.equal(Number((await query("SELECT commission_override_cents FROM wl.employee_job_assignments WHERE booking_id=$1 AND employee_id=$2",[mixedFlatJob,mixed]))[0].commission_override_cents),4321);
    assert.equal(Number((await summary(mixed)).commission_cents),24319, "explicit $43.21 is final, not multiplied by the 25% share");
    await adminAction("save_job_assignments", { booking_id:mixedFlatJob,assignments:[
      { employee_id:mixed,pool_share_bps:2500,commission_override_cents:null },{ employee_id:partner,pool_share_bps:7500 },
    ] },sessions.manager);
    assert.equal(Number((await summary(mixed)).commission_cents),21998, "clearing override restores $80 flat service rate × 25%");
    t.diagnostic("assignment overrides survive split-only edits, take priority, and can be explicitly cleared");

    const period = await adminAction("save_pay_period", { start_date:"2026-09-29",end_date:"2026-09-29",frequency:"weekly" },sessions.manager) as {id:string};
    await adminAction("lock_pay_period",{id:period.id},sessions.manager);
    const paidSnapshot = await query("SELECT * FROM wl.payroll_records WHERE pay_period_id=$1 ORDER BY employee_id",[period.id]);
    assert.equal(Number(paidSnapshot.find((entry) => entry.employee_id === combined)!.estimated_gross_cents),10000);
    await save(plan(combined,"flat_job",0,0,1234));
    await adminAction("save_pay_rule",{ employee_id:combined,service_id:services[0].id,rule_type:"commission_percent",value:5000,active:true },sessions.manager);
    await assert.rejects(adminAction("lock_pay_period",{id:period.id},sessions.manager),/already paid/);
    assert.deepEqual(await query("SELECT * FROM wl.payroll_records WHERE pay_period_id=$1 ORDER BY employee_id",[period.id]),paidSnapshot);
    t.diagnostic("changing default and service rates cannot rewrite a paid payroll snapshot");

    const beforeValidation = await query("SELECT * FROM wl.employees WHERE id=$1",[combined]);
    for (const invalid of [
      {default_commission_bps:10001},{default_commission_bps:-1},{default_commission_bps:1.5},
      {hourly_rate_cents:-1},{hourly_rate_cents:100000001},{hourly_rate_cents:Number.NaN},
      {flat_job_pay_cents:100000001},{flat_job_pay_cents:Number.POSITIVE_INFINITY},
      {hourly_rate_cents:undefined},{compensation_model:"unknown"},
    ]) await assert.rejects(adminAction("save_employee_compensation", {...plan(combined,"commission",2000,2500,0),...invalid}, sessions.manager));
    await assert.rejects(adminAction("save_pay_rule",rule(null,"commission_percent",10001),sessions.manager),/cannot exceed 100%/);
    await assert.rejects(adminAction("save_pay_rule",rule(null,"flat_job",100000001),sessions.manager));
    await assert.rejects(adminAction("save_pay_rule",rule(randomUUID(),"flat_job",1000),sessions.manager),/Service not found/);
    await assert.rejects(save(plan(randomUUID(),"commission",0,2500)),/Employee not found/);
    assert.deepEqual(await query("SELECT * FROM wl.employees WHERE id=$1",[combined]),beforeValidation);
    await save(plan(combined,"commission",0,0));
    assert.equal(Number((await query("SELECT default_commission_bps FROM wl.employees WHERE id=$1",[combined]))[0].default_commission_bps),0);
    await save(plan(combined,"commission",0,10000));
    assert.equal(Number((await query("SELECT default_commission_bps FROM wl.employees WHERE id=$1",[combined]))[0].default_commission_bps),10000);
    const unauthorized = (error:unknown) => error instanceof Error && "status" in error && error.status === 403;
    for (const action of ["save_employee_compensation","save_pay_rule","save_employee","assign_job_employee","save_job_assignments"])
      await assert.rejects(adminAction(action,{},sessions.staff),unauthorized);
    t.diagnostic("owner/admin/manager can save compensation; invalid rates reject atomically and staff cannot edit pay");

    const profile = { name:"New Detailer",email:`${randomUUID()}@example.test`,phone:"+15555550000",position:"Detailer",hourly_rate_cents:1800,password:"fixture-password-123",max_weekly_minutes:2400,hire_date:null,notes:"",active:true,
      availability:Array.from({length:7},(_,weekday)=>({weekday,available:false,start_minute:480,end_minute:1020})) };
    const created = await adminAction("save_employee",profile,sessions.manager) as {id:string};
    assert.deepEqual(await query("SELECT hourly_rate_cents,compensation_model,default_commission_bps FROM wl.employees WHERE id=$1",[created.id]),[
      {hourly_rate_cents:1800,compensation_model:"hourly_commission",default_commission_bps:3000},
    ]);
    await save(plan(created.id,"flat_job",2200,1200,6543));
    await adminAction("save_employee",{...profile,id:created.id,password:"",position:"Manager",hourly_rate_cents:1000},sessions.manager);
    await adminAction("save_employee",{...profile,id:created.id,password:"",hourly_rate_cents:undefined},sessions.manager);
    assert.deepEqual(await query("SELECT hourly_rate_cents,compensation_model,default_commission_bps,flat_job_pay_cents FROM wl.employees WHERE id=$1",[created.id]),[
      {hourly_rate_cents:2200,compensation_model:"flat_job",default_commission_bps:1200,flat_job_pay_cents:6543},
    ]);
    const payrollData = await adminData("payroll",new URLSearchParams({start:"2026-09-29",end:"2026-09-29"}),sessions.manager) as {employees:Row[]};
    assert.equal(Number(payrollData.employees.find((entry) => entry.id === created.id)!.hourly_rate_cents),2200);
    t.diagnostic("new Detailers get a configurable starting plan; stale profile edits preserve all saved pay settings");
  } finally { await closeDatabase(); }
});
