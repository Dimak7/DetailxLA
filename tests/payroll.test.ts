import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closeDatabase, query } from "../lib/platform/db";
import { payrollSummary } from "../lib/platform/payroll";

process.env.PGLITE_PATH = "memory://payroll";
delete process.env.DATABASE_URL;

test("standard detailer payroll uses actual time, a shared commission pool, and equal default tips", async () => {
  try {
    const service = (await query<{ id: string }>("SELECT id FROM wl.services LIMIT 1"))[0];
    const customer = randomUUID(), vehicle = randomUUID(), booking = randomUUID(), first = randomUUID(), second = randomUUID();
    await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone) VALUES($1,'Pay','Customer',$2,'+15550000000')", [customer, "payroll-" + customer + "@test.local"]);
    await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Test','Car',2024,'Car')", [vehicle, customer]);
    await query("INSERT INTO wl.employees(id,name,email,phone,position,hourly_rate_cents,compensation_model,default_commission_bps,active) VALUES($1,'Josh Test','josh@test.local','+15550000001','Detailer',9900,'hourly_commission',9900,true),($2,'Mark Test','mark@test.local','+15550000002','Detailer',1,'commission',1,true)", [first, second]);
    await query("INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,status,price_cents,tip_cents) VALUES($1,$2,'hash',$3,$4,$5,$6,'Full Detail','{}','2026-09-20',600,120,'completed',30000,5000)", [booking, randomUUID(), "PAY-" + booking.slice(0, 8), customer, vehicle, service.id]);
    await query("INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,status,kind,paid_at) VALUES($1,$2,$3,30000,'paid','balance','2026-09-20T18:00:00Z')", [randomUUID(), booking, customer]);
    await query("INSERT INTO wl.employee_job_assignments(id,booking_id,employee_id,pool_share_bps) VALUES($1,$2,$3,4000),($4,$2,$5,6000)", [randomUUID(), booking, first, randomUUID(), second]);
    await query("INSERT INTO wl.time_entries(id,employee_id,clock_in,clock_out,break_minutes) VALUES($1,$2,'2026-09-20T14:00:00Z','2026-09-20T16:00:00Z',0)", [randomUUID(), first]);
    const rows = await payrollSummary("2026-09-20", "2026-09-20");
    const josh = rows.find((row) => row.id === first)!;
    const mark = rows.find((row) => row.id === second)!;
    assert.equal(Number(josh.minutes), 120);
    assert.equal(Number(josh.hourly_rate_cents), 1000);
    assert.equal(Number(josh.hourly_earnings_cents), 2000);
    assert.equal(Number(josh.commission_cents), 3600);
    assert.equal(Number(josh.tips_cents), 2500);
    assert.equal(Number(josh.total_earnings_cents), 8100);
    assert.equal(Number(mark.commission_cents), 5400);
    assert.equal(Number(mark.tips_cents), 2500);
    assert.equal(Number(mark.total_earnings_cents), 7900);
    assert.equal(Number(josh.commission_cents) + Number(mark.commission_cents), 9000);
  } finally { await closeDatabase(); }
});

test("explicit tip allocations do not change the 30 percent commission pool", async () => {
  try {
    const service = (await query<{ id: string }>("SELECT id FROM wl.services LIMIT 1"))[0];
    const customer = randomUUID(), vehicle = randomUUID(), booking = randomUUID(), first = randomUUID(), second = randomUUID();
    await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone) VALUES($1,'Tip','Customer',$2,'+15550000010')", [customer, "tips-" + customer + "@test.local"]);
    await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Test','SUV',2024,'SUV')", [vehicle, customer]);
    await query("INSERT INTO wl.employees(id,name,email,phone,position,active) VALUES($1,'Josh Tip','josh-tip@test.local','+15550000011','Detailer',true),($2,'Mark Tip','mark-tip@test.local','+15550000012','Detailer',true)", [first, second]);
    await query("INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,status,price_cents,tip_cents) VALUES($1,$2,'hash',$3,$4,$5,$6,'Full Detail','{}','2026-09-21',600,120,'completed',27000,5000)", [booking, randomUUID(), "TIP-" + booking.slice(0, 8), customer, vehicle, service.id]);
    await query("INSERT INTO wl.employee_job_assignments(id,booking_id,employee_id,pool_share_bps,tip_override_cents) VALUES($1,$2,$3,5000,5000),($4,$2,$5,5000,0)", [randomUUID(), booking, first, randomUUID(), second]);
    const rows = await payrollSummary("2026-09-21", "2026-09-21");
    const josh = rows.find((row) => row.id === first)!;
    const mark = rows.find((row) => row.id === second)!;
    assert.equal(Number(josh.commission_cents), 4050);
    assert.equal(Number(mark.commission_cents), 4050);
    assert.equal(Number(josh.tips_cents), 5000);
    assert.equal(Number(mark.tips_cents), 0);
    assert.equal(Number(josh.commission_cents) + Number(mark.commission_cents), 8100);
    assert.equal(Number(josh.tips_cents) + Number(mark.tips_cents), 5000);
  } finally { await closeDatabase(); }
});

test("scheduled shifts become payable only when the period has no actual clocked hours", async () => {
  try {
    const employee = randomUUID();
    await query("INSERT INTO wl.employees(id,name,email,phone,position,active) VALUES($1,'Scheduled Detailer','scheduled@test.local','+15550000020','Detailer',true)", [employee]);
    await query("INSERT INTO wl.employee_shifts(id,employee_id,shift_date,start_minute,end_minute,break_minutes,status) VALUES($1,$2,'2026-09-22',540,1020,0,'scheduled')", [randomUUID(), employee]);
    const fallback = (await payrollSummary("2026-09-22", "2026-09-22")).find((row) => row.id === employee)!;
    assert.equal(Number(fallback.scheduled_minutes), 480);
    assert.equal(Number(fallback.actual_minutes), 0);
    assert.equal(Number(fallback.minutes), 480);
    assert.equal(String(fallback.paid_hours_source), "scheduled_fallback");
    assert.equal(Number(fallback.hourly_earnings_cents), 8000);
    await query("INSERT INTO wl.time_entries(id,employee_id,clock_in,clock_out,break_minutes) VALUES($1,$2,'2026-09-22T15:00:00Z','2026-09-22T18:00:00Z',0)", [randomUUID(), employee]);
    const actual = (await payrollSummary("2026-09-22", "2026-09-22")).find((row) => row.id === employee)!;
    assert.equal(Number(actual.actual_minutes), 180);
    assert.equal(Number(actual.minutes), 180);
    assert.equal(String(actual.paid_hours_source), "actual_clocked");
    assert.equal(Number(actual.hourly_earnings_cents), 3000);
  } finally { await closeDatabase(); }
});
