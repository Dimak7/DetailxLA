import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { adminData } from "../lib/platform/admin";
import { closeDatabase, database, query } from "../lib/platform/db";
import { dateToday, type Row, type Session } from "../lib/platform/types";

Object.assign(process.env, { NODE_ENV: "test", PGLITE_PATH: "memory://booking-views" });
for (const key of ["DATABASE_URL", "RAILWAY_ENVIRONMENT", "ADMIN_EMAIL", "ADMIN_PASSWORD", "SQUARE_ACCESS_TOKEN", "STRIPE_SECRET_KEY", "EMAIL_PROVIDER_API_KEY", "RESEND_API_KEY", "TELEGRAM_BOT_TOKEN", "TWILIO_AUTH_TOKEN"])
  delete process.env[key];

test("booking views separate everyday work while preserving history, deep links and payment records", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Booking-view tests must not contact external services"); });
  try {
    await database();
    const user: Session = { id: "fixture-session", user_id: randomUUID(), name: "View owner", email: "view-owner@example.test", role: "owner" };
    await query("INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,$2,$3,'fixture','owner')", [user.user_id, user.name, user.email]);
    const customer = randomUUID(), archivedCustomer = randomUUID(), vehicle = randomUUID(), archivedVehicle = randomUUID();
    await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone) VALUES($1,'Booking','View','booking-view@example.test',''),($2,'Archived','View','archived-view@example.test','')", [customer, archivedCustomer]);
    await query("UPDATE wl.customers SET archived_at=now() WHERE id=$1", [archivedCustomer]);
    await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Fixture','Coupe',2026,'Sedan'),($3,$4,'Fixture','Coupe',2026,'Sedan')", [vehicle, customer, archivedVehicle, archivedCustomer]);
    const service = (await query<{ id: string }>("SELECT id FROM wl.services ORDER BY sort_order,id LIMIT 1"))[0].id;
    const today = dateToday();
    const relativeDate = (offset: number) => {
      const date = new Date(`${today}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    };
    const statuses = ["new", "confirmed", "in_progress", "completed", "cancelled", "no_show"] as const;
    const jobs: Array<{ id: string; reference: string; status: string; date: string; archived: boolean }> = [];
    for (const archived of [false, true]) {
      for (const offset of [-1, 0, 1]) {
        for (const status of statuses) {
          const id = randomUUID(), reference = `${archived ? "ARCHIVE" : "VIEW"}-${status}-${offset + 1}`, date = relativeDate(offset);
          await query(`INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,status,price_cents)
            VALUES($1::uuid,$1::text,'fixture',$2,$3,$4,$5,'Fixture detail','{}',$6,600,60,$7,10000)`,
          [id, reference, archived ? archivedCustomer : customer, archived ? archivedVehicle : vehicle, service, date, status]);
          jobs.push({ id, reference, status, date, archived });
        }
      }
    }
    const completed = jobs.find(job => !job.archived && job.date === today && job.status === "completed")!;
    const cancelled = jobs.find(job => !job.archived && job.date === today && job.status === "cancelled")!;
    await query("INSERT INTO wl.payments(id,booking_id,customer_id,provider,amount_cents,status,paid_at) VALUES($1,$2,$3,'manual',2500,'paid',now())", [randomUUID(), completed.id, customer]);
    await query("INSERT INTO wl.square_payments(environment,payment_id,status,amount_cents,currency,paid_at) VALUES('production','booking-view-square','COMPLETED',3000,'USD',now())");
    const snapshot = () => Promise.all([
      query("SELECT * FROM wl.bookings ORDER BY id"),
      query("SELECT * FROM wl.payments ORDER BY id"),
      query("SELECT * FROM wl.square_payments ORDER BY payment_id"),
    ]);
    const before = await snapshot();
    const activeJobs = jobs.filter(job => !job.archived);
    async function check(params: Record<string, string>, expected: typeof jobs, view: string) {
      const data = await adminData("bookings", new URLSearchParams(params), user);
      assert.ok("bookingView" in data && "total" in data);
      assert.equal(data.bookingView, view);
      assert.equal(data.total, expected.length, "The count and displayed records use the same filter");
      assert.deepEqual((data.rows as Row[]).map(row => row.id).sort(), expected.map(job => job.id).sort());
    }
    const activeStatuses = new Set(["new", "confirmed", "in_progress"]);
    const unfinished = activeJobs.filter(job => activeStatuses.has(job.status));
    await check({}, unfinished, "active");
    await check({ view: "active" }, unfinished, "active");
    await check({ view: "all" }, activeJobs, "all");
    await check({ date: today }, unfinished.filter(job => job.date === today), "active");
    await check({ view: "active", date: today }, unfinished.filter(job => job.date === today), "active");
    await check({ view: "all", date: today }, activeJobs.filter(job => job.date === today), "all");
    for (const status of statuses) {
      const expected = activeJobs.filter(job => job.status === status);
      await check({ status }, expected, status);
      await check({ view: "active", status }, expected, status);
    }
    await check({ view: "upcoming" }, activeJobs.filter(job => job.date >= today && ["new", "confirmed"].includes(job.status)), "upcoming");
    await check({ view: "past" }, activeJobs.filter(job => job.date < today), "past");
    await check({ view: "past", status: "cancelled" }, activeJobs.filter(job => job.date < today && job.status === "cancelled"), "cancelled");
    for (const job of [completed, cancelled]) {
      await check({ id: job.id }, [job], "all");
      await check({ search: job.reference }, [job], "all");
      await check({ view: "active", search: job.reference }, [], "active");
    }
    await check({ search: "Booking View" }, activeJobs, "all");
    await check({ search: "", view: "all" }, activeJobs, "all");
    await check({ archived: "1" }, jobs.filter(job => job.archived), "archived");
    await check({ archived: "1", status: "completed" }, jobs.filter(job => job.archived && job.status === "completed"), "completed");
    const manager = { ...user, role: "manager" as const };
    await assert.rejects(adminData("bookings", new URLSearchParams({ archived: "1" }), manager), /owner|admin|archiv/i);
    const managerRows = (await adminData("bookings", new URLSearchParams(), manager)).rows as Row[];
    assert.deepEqual(managerRows.map(row => row.id).sort(), unfinished.map(job => job.id).sort());
    await assert.rejects(adminData("bookings", new URLSearchParams(), { ...user, role: "staff" }), /access/i);

    const calendar = await adminData("calendar", new URLSearchParams({ date: today }), user);
    assert.ok("total" in calendar);
    const calendarStart = new Date(`${today}T12:00:00Z`);
    calendarStart.setUTCDate(1);
    calendarStart.setUTCDate(calendarStart.getUTCDate() - calendarStart.getUTCDay());
    const calendarEnd = new Date(calendarStart);
    calendarEnd.setUTCDate(calendarEnd.getUTCDate() + 41);
    const calendarJobs = activeJobs.filter(job => job.date >= calendarStart.toISOString().slice(0, 10) && job.date <= calendarEnd.toISOString().slice(0, 10));
    assert.equal(calendar.total, calendarJobs.length);
    assert.deepEqual((calendar.rows as Row[]).map(row => row.id).sort(), calendarJobs.map(job => job.id).sort());
    for (const params of [{}, { view: "active" }] as Array<Record<string, string>>) {
      const payments = await adminData("payments", new URLSearchParams(params), user);
      assert.ok("total" in payments && "payments" in payments && "squarePayments" in payments);
      assert.equal(payments.total, jobs.length, "Payments keeps every status and archived-customer appointment");
      assert.equal(payments.payments?.length, 1);
      assert.ok(payments.squarePayments?.some(row => row.payment_id === "booking-view-square"));
    }
    assert.deepEqual(await snapshot(), before, "Switching views cannot modify bookings or payment ledgers");
  } finally {
    await closeDatabase();
  }
});
