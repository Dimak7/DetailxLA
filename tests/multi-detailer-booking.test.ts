import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adminAction, adminData } from "../lib/platform/admin";
import { closeDatabase, query } from "../lib/platform/db";
import { payrollSummary } from "../lib/platform/payroll";
import { dateToday, type Session } from "../lib/platform/types";

process.env.PGLITE_PATH = "memory://multi-detailer-booking";
Object.assign(process.env, { NODE_ENV: "test" });
delete process.env.DATABASE_URL;
delete process.env.RAILWAY_ENVIRONMENT;

test("multiple detailers receive equal automatic shares and each can access the job", async () => {
  try {
    const ownerId = randomUUID();
    const owner: Session = {
      id: randomUUID(),
      user_id: ownerId,
      name: "Owner",
      email: "multi-owner@example.test",
      role: "owner",
    };
    await query(
      "INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,$2,$3,'fixture','owner')",
      [ownerId, owner.name, owner.email],
    );
    const staff = await Promise.all(
      ["Matthew", "Josh"].map(async (name) => {
        const userId = randomUUID();
        const employeeId = randomUUID();
        await query(
          "INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,$2,$3,'fixture','staff')",
          [userId, name, `${name.toLowerCase()}@example.test`],
        );
        await query(
          "INSERT INTO wl.employees(id,user_id,name,email,position,compensation_model,default_commission_bps) VALUES($1,$2,$3,$4,'Detailer','commission',2000)",
          [employeeId, userId, name, `${name.toLowerCase()}@example.test`],
        );
        return { employeeId, userId, name };
      }),
    );
    const service = (await query<{ id: string }>("SELECT id FROM wl.services LIMIT 1"))[0].id;
    const customerId = randomUUID();
    const vehicleId = randomUUID();
    const bookingId = randomUUID();
    const bookingDate = dateToday();
    await query(
      "INSERT INTO wl.customers(id,first_name,last_name,email,phone) VALUES($1,'Shared','Job','shared@example.test','+13125550110')",
      [customerId],
    );
    await query(
      "INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Porsche','911',2026,'Coupe')",
      [vehicleId, customerId],
    );
    await query(
      `INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,status,price_cents,tip_cents)
       VALUES($1,$5,'fixture','WL-SHARED',$2,$3,$4,'Full Detail','{}',$6,480,120,'confirmed',25000,1001)`,
      [bookingId, customerId, vehicleId, service, randomUUID(), bookingDate],
    );

    await adminAction(
      "save_job_assignments",
      { booking_id: bookingId, employee_ids: staff.map((person) => person.employeeId) },
      owner,
    );

    const assignments = await query<{
      employee_id: string;
      pool_share_bps: number;
      tip_override_cents: number | null;
    }>(
      "SELECT employee_id,pool_share_bps,tip_override_cents FROM wl.employee_job_assignments WHERE booking_id=$1 ORDER BY employee_id",
      [bookingId],
    );
    assert.equal(assignments.length, 2);
    assert.deepEqual(assignments.map((row) => Number(row.pool_share_bps)), [5000, 5000]);
    assert.ok(assignments.every((row) => row.tip_override_cents === null));
    assert.equal(
      (await query<{ assigned_to: string }>("SELECT assigned_to FROM wl.bookings WHERE id=$1", [bookingId]))[0].assigned_to,
      staff[0].userId,
    );

    for (const person of staff) {
      const session: Session = {
        id: randomUUID(),
        user_id: person.userId,
        name: person.name,
        email: `${person.name.toLowerCase()}@example.test`,
        role: "staff",
      };
      const schedule = await adminData("my_schedule", new URLSearchParams(), session);
      assert.ok("appointments" in schedule);
      assert.deepEqual(schedule.appointments?.map((row) => row.id), [bookingId]);
    }

    const secondarySession: Session = {
      id: randomUUID(),
      user_id: staff[1].userId,
      name: staff[1].name,
      email: `${staff[1].name.toLowerCase()}@example.test`,
      role: "staff",
    };
    await adminAction("update_booking", { id: bookingId, status: "in_progress" }, secondarySession);
    await adminAction("update_booking", { id: bookingId, status: "completed" }, secondarySession);

    const payroll = await payrollSummary(bookingDate, bookingDate);
    const tips = staff.map((person) => Number(payroll.find((row) => row.id === person.employeeId)?.tips_cents));
    assert.equal(tips.reduce((total, tip) => total + tip, 0), 1001);
    assert.deepEqual([...tips].sort((a, b) => a - b), [500, 501]);
  } finally {
    await closeDatabase();
  }
});
