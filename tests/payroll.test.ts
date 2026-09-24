import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closeDatabase, query } from "../lib/platform/db";
import { payrollSummary } from "../lib/platform/payroll";

process.env.PGLITE_PATH = "memory://payroll";
delete process.env.DATABASE_URL;

test("payroll uses actual time and completed assigned jobs", async () => {
  try {
    const service = (await query<{ id: string }>("SELECT id FROM wl.services LIMIT 1"))[0];
    const customer = randomUUID(), vehicle = randomUUID(), booking = randomUUID(), first = randomUUID(), second = randomUUID();
    await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone) VALUES($1,'Pay','Customer',$2,'+15550000000')", [customer, "payroll-" + customer + "@test.local"]);
    await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Test','Car',2024,'Car')", [vehicle, customer]);
    await query("INSERT INTO wl.employees(id,name,email,phone,position,hourly_rate_cents,compensation_model,default_commission_bps,active) VALUES($1,'Josh Test','josh@test.local','+15550000001','Detailer',2000,'hourly_commission',3000,true),($2,'Mark Test','mark@test.local','+15550000002','Detailer',0,'commission',3000,true)", [first, second]);
    await query("INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,status,price_cents) VALUES($1,$2,'hash',$3,$4,$5,$6,'Full Detail','{}','2026-09-20',600,120,'completed',30000)", [booking, randomUUID(), "PAY-" + booking.slice(0, 8), customer, vehicle, service.id]);
    await query("INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,status,kind,paid_at) VALUES($1,$2,$3,30000,'paid','balance','2026-09-20T18:00:00Z')", [randomUUID(), booking, customer]);
    await query("INSERT INTO wl.employee_job_assignments(id,booking_id,employee_id,pool_share_bps) VALUES($1,$2,$3,4000),($4,$2,$5,6000)", [randomUUID(), booking, first, randomUUID(), second]);
    await query("INSERT INTO wl.time_entries(id,employee_id,clock_in,clock_out,break_minutes) VALUES($1,$2,'2026-09-20T14:00:00Z','2026-09-20T16:00:00Z',0)", [randomUUID(), first]);
    const rows = await payrollSummary("2026-09-20", "2026-09-20");
    const josh = rows.find((row) => row.id === first)!;
    const mark = rows.find((row) => row.id === second)!;
    assert.equal(Number(josh.hourly_earnings_cents), 4000);
    assert.equal(Number(josh.commission_cents), 3600);
    assert.equal(Number(josh.total_earnings_cents), 7600);
    assert.equal(Number(mark.commission_cents), 5400);
    assert.equal(Number(mark.total_earnings_cents), 5400);
  } finally { await closeDatabase(); }
});
