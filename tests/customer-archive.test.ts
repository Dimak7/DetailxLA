import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { query, transaction, closeDatabase } from "../lib/platform/db";
import { setCustomerArchived } from "../lib/platform/customer-archive";
import { adminAction, adminData } from "../lib/platform/admin";
import { audience } from "../lib/platform/campaigns";
import { processOutbox } from "../lib/platform/worker";
import { hash } from "../lib/platform/auth";
import { exportSquareCustomerHistory, importSquareCustomerHistory, parseSquareCustomerHistory, squareCustomerHistory } from "../lib/platform/square-customer-history";
import { POST } from "../app/api/admin/customer-archive/route";
import { report } from "../lib/platform/reporting";
import { dateToday, type Row, type Session } from "../lib/platform/types";

Object.assign(process.env, { NODE_ENV: "test", PGLITE_PATH: "memory://customer-archive" });
for (const key of ["DATABASE_URL", "RAILWAY_ENVIRONMENT", "ADMIN_EMAIL", "ADMIN_PASSWORD", "SQUARE_ACCESS_TOKEN", "STRIPE_SECRET_KEY", "EMAIL_PROVIDER_API_KEY", "RESEND_API_KEY", "TELEGRAM_BOT_TOKEN", "TWILIO_AUTH_TOKEN"])
  delete process.env[key];

async function owner(): Promise<Session> {
  const id = randomUUID(), email = `${id}@example.test`;
  await query("INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,'Archive owner',$2,'fixture','owner')", [id, email]);
  return { id: "fixture", user_id: id, name: "Archive owner", email, role: "owner" };
}
async function customer(email = `${randomUUID()}@example.test`) {
  const id = randomUUID();
  await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone,marketing_email,marketing_sms) VALUES($1,'Archive','Fixture',$2,'+13125550124',true,true)", [id, email]);
  return { id, email };
}
async function history(id: string, customerId: string | null = null) {
  const email = `${id.toLowerCase()}@example.test`, fields = parseSquareCustomerHistory(csv(id, email)).rows[0].source_fields;
  await query("INSERT INTO wl.square_customer_history(square_customer_id,customer_id,first_name,email,transaction_count,lifetime_spend_cents,source_filename,source_hash,source_fields) VALUES($1,$2,'Archive fixture',$3,2,10050,'fixture.csv','fixture',$4::jsonb)", [id, customerId, email, JSON.stringify(fields)]);
}
function csv(id: string, email: string, name = "Archive", subscription = "subscribed") {
  return [["Square Customer ID", "First Name", "Last Name", "Email Address", "Phone Number", "Creation Source", "First Visit", "Last Visit", "Transaction Count", "Lifetime Spend", "Email Subscription Status", "Instant Profile"],
    [id, name, "Fixture", email, "", "Directory", "2026-06-05", "2026-10-14", "2", "100.50", subscription, "No"]]
    .map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n");
}
const change = (id: string, action: "archive" | "restore" = "archive", kind: "customer" | "square-profile" = "customer") => ({ id, action, kind });

test("customer archive removes active contacts while preserving paid bookings, revenue and team access", async () => {
  try {
    const user = await owner(), fixture = await customer(user.email), keep = await customer();
    const vehicle = randomUUID(), booking = randomUUID(), payment = randomUUID(), employee = randomUUID();
    const service = (await query<{ id: string }>("SELECT id FROM wl.services ORDER BY sort_order LIMIT 1"))[0].id;
    await query("INSERT INTO wl.employees(id,user_id,name,email,active) VALUES($1,$2,'Archive owner',$3,true)", [employee, user.user_id, user.email]);
    await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Fixture','Coupe',2026,'Sedan')", [vehicle, fixture.id]);
    await query("INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,price_cents,status) VALUES($1,$2,'fixture',$2,$3,$4,$5,'Detail','{}','2026-10-15',480,60,12000,'completed')", [booking, randomUUID(), fixture.id, vehicle, service]);
    await query("INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,status,provider,external_id,metadata,paid_at) VALUES($1,$2,$3,6000,'paid','square','archive-real-payment','{\"square_environment\":\"production\"}',now())", [payment, booking, fixture.id]);
    await query("INSERT INTO wl.square_payments(environment,payment_id,status,amount_cents,currency,paid_at) VALUES('production','archive-real-payment','COMPLETED',6000,'USD',now())");
    await history("LINKED", fixture.id);
    const preserved = await Promise.all([
      query("SELECT * FROM wl.bookings WHERE id=$1", [booking]), query("SELECT * FROM wl.payments WHERE id=$1", [payment]),
      query("SELECT * FROM wl.square_payments"), query("SELECT * FROM wl.revenue_payments"),
      query("SELECT * FROM wl.users WHERE id=$1", [user.user_id]), query("SELECT * FROM wl.employees WHERE id=$1", [employee]),
    ]);
    await setCustomerArchived(user, change(fixture.id));
    const customerRows = (await adminData("customers", new URLSearchParams(), user)).rows as Row[];
    assert.deepEqual(customerRows.map(row => row.id), [keep.id]);
    const archived = (await adminData("customers", new URLSearchParams("archived=1"), user)).rows as Row[];
    assert.deepEqual(archived.map(row => row.id), [fixture.id]);
    assert.equal((await squareCustomerHistory(user)).rows.length, 0);
    assert.equal((await squareCustomerHistory(user, 1, "", true)).rows[0]?.square_customer_id, "LINKED");
    assert.deepEqual(await Promise.all([
      query("SELECT * FROM wl.bookings WHERE id=$1", [booking]), query("SELECT * FROM wl.payments WHERE id=$1", [payment]),
      query("SELECT * FROM wl.square_payments"), query("SELECT * FROM wl.revenue_payments"),
      query("SELECT * FROM wl.users WHERE id=$1", [user.user_id]), query("SELECT * FROM wl.employees WHERE id=$1", [employee]),
    ]), preserved);
    const timestamp = (await query<{ archived_at: string }>("SELECT archived_at FROM wl.customers WHERE id=$1", [fixture.id]))[0].archived_at;
    await setCustomerArchived(user, change(fixture.id));
    assert.deepEqual((await query<{ archived_at: string }>("SELECT archived_at FROM wl.customers WHERE id=$1", [fixture.id]))[0].archived_at, timestamp, "repeated archive keeps original archive time");
    await setCustomerArchived(user, change(fixture.id, "restore"));
    await setCustomerArchived(user, change(fixture.id, "restore"));
    assert.equal(((await adminData("customers", new URLSearchParams(), user)).rows as Row[]).length, 2);
    assert.equal((await squareCustomerHistory(user)).rows.length, 1);
  } finally { await closeDatabase(); }
});

test("Bookings separates archived customer appointments without changing payment history or booking records", async () => {
  try {
    const user = await owner();
    const service = (await query<{ id: string }>("SELECT id FROM wl.services ORDER BY sort_order LIMIT 1"))[0].id;
    const fixtures: { id: string; booking: string; name: string }[] = [];
    for (const name of ["Tony", "Dima", "Moe"]) {
      const fixture = await customer(), vehicle = randomUUID(), booking = randomUUID();
      await query("UPDATE wl.customers SET first_name=$2,last_name='Booking fixture' WHERE id=$1", [fixture.id, name]);
      await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Fixture','Coupe',2026,'Sedan')", [vehicle, fixture.id]);
      await query("INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,price_cents,status) VALUES($1,$2,'fixture',$2,$3,$4,$5,'Detail','{}','2030-06-15',480,60,12000,'completed')", [booking, randomUUID(), fixture.id, vehicle, service]);
      if (name !== "Tony") {
        const external = `booking-archive-${name.toLowerCase()}`;
        await query("INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,status,provider,external_id,metadata,paid_at) VALUES($1,$2,$3,6000,'paid','square',$4,'{\"square_environment\":\"production\"}',now())", [randomUUID(), booking, fixture.id, external]);
        await query("INSERT INTO wl.square_payments(environment,payment_id,status,amount_cents,currency,paid_at) VALUES('production',$1,'COMPLETED',6000,'USD',now())", [external]);
      }
      fixtures.push({ id: fixture.id, booking, name });
    }
    const [tony, dima, moe] = fixtures;
    const readPreserved = () => Promise.all([
      query("SELECT * FROM wl.bookings ORDER BY id"),
      query("SELECT * FROM wl.payments ORDER BY id"),
      query("SELECT * FROM wl.square_payments ORDER BY payment_id"),
      query("SELECT * FROM wl.revenue_payments ORDER BY id"),
    ]);
    const preserved = await readPreserved();
    const beforePayments = await adminData("payments", new URLSearchParams(), user);
    assert.ok("payments" in beforePayments && "squarePayments" in beforePayments);
    await setCustomerArchived(user, change(dima.id));
    await setCustomerArchived(user, change(moe.id));

    const active = await adminData("bookings", new URLSearchParams(), user);
    assert.ok("total" in active && "archivedBookings" in active);
    assert.deepEqual((active.rows as Row[]).map(row => row.id), [tony.booking]);
    assert.equal(active.total, 1, "active count must use the same archive filter as the records");
    assert.equal(active.archivedBookings, false);
    for (const role of ["owner", "admin"] as const) {
      const archived = await adminData("bookings", new URLSearchParams("archived=1"), { ...user, role });
      assert.ok("total" in archived && "archivedBookings" in archived);
      assert.deepEqual((archived.rows as Row[]).map(row => row.id).sort(), [dima.booking, moe.booking].sort());
      assert.equal(archived.total, 2);
      assert.equal(archived.archivedBookings, true);
    }
    const filtered = await adminData("bookings", new URLSearchParams("archived=1&search=Dima&date=2030-06-15&status=completed"), user);
    assert.ok("total" in filtered);
    assert.deepEqual((filtered.rows as Row[]).map(row => row.id), [dima.booking]);
    assert.equal(filtered.total, 1);
    const wrongDate = await adminData("bookings", new URLSearchParams("archived=1&date=2030-06-16"), user);
    assert.ok("total" in wrongDate);
    assert.equal(wrongDate.total, 0);
    const manager = { ...user, role: "manager" as const };
    assert.deepEqual(((await adminData("bookings", new URLSearchParams(), manager)).rows as Row[]).map(row => row.id), [tony.booking]);
    await assert.rejects(() => adminData("bookings", new URLSearchParams("archived=1"), manager), /owner|admin|archiv|access/i);

    const afterPayments = await adminData("payments", new URLSearchParams(), user);
    assert.ok("payments" in afterPayments && "squarePayments" in afterPayments);
    assert.deepEqual(afterPayments.rows, beforePayments.rows, "Payments keeps appointments for archived customers");
    assert.deepEqual(afterPayments.payments, beforePayments.payments);
    assert.deepEqual(afterPayments.squarePayments, beforePayments.squarePayments);
    assert.deepEqual(await readPreserved(), preserved, "archiving customer visibility must not mutate any booking or payment");
    const profile = await adminData("customers", new URLSearchParams({ id: dima.id, archived: "1" }), user);
    assert.ok("profile" in profile);
    assert.deepEqual((profile.profile?.bookings as Row[]).map(row => row.id), [dima.booking]);

    await setCustomerArchived(user, change(dima.id, "restore"));
    const restored = await adminData("bookings", new URLSearchParams(), user);
    assert.ok("total" in restored);
    assert.deepEqual((restored.rows as Row[]).map(row => row.id).sort(), [tony.booking, dima.booking].sort());
    assert.equal(restored.total, 2);
    assert.deepEqual(((await adminData("bookings", new URLSearchParams("archived=1"), user)).rows as Row[]).map(row => row.id), [moe.booking]);
    assert.deepEqual(await readPreserved(), preserved);
  } finally { await closeDatabase(); }
});

test("archived customers stay out of calendars, dashboard operations and staff schedules while Square finances remain intact", async () => {
  try {
    const user = await owner(), today = dateToday(), employee = randomUUID(), attribution = randomUUID();
    const service = (await query<{ id: string }>("SELECT id FROM wl.services ORDER BY sort_order LIMIT 1"))[0].id;
    const period = new URLSearchParams({ from: today, to: today });
    await query("INSERT INTO wl.employees(id,user_id,name,email,position,active) VALUES($1,$2,'Archive owner',$3,'Detailer',true)", [employee, user.user_id, user.email]);
    await query("INSERT INTO wl.employee_shifts(id,employee_id,shift_date,start_minute,end_minute,published) VALUES($1,$2,$3,480,1080,true)", [randomUUID(), employee, today]);
    await query("INSERT INTO wl.attributions(id,session_id,source,lead_stream,campaign,gclid) VALUES($1,$2,'Google Ads','Dima Leads','archive-operations','fixture-click')", [attribution, randomUUID()]);
    const fixtures: { id: string; booking: string; name: string }[] = [];
    for (const [index, name] of ["Tony", "Dima", "Moe"].entries()) {
      const fixture = await customer(), vehicle = randomUUID(), booking = randomUUID();
      await query("UPDATE wl.customers SET first_name=$2,last_name='Operations fixture' WHERE id=$1", [fixture.id, name]);
      await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Fixture','Coupe',2026,'Sedan')", [vehicle, fixture.id]);
      await query("INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,price_cents,status,attribution_id) VALUES($1,$2,'fixture',$2,$3,$4,$5,'Detail','{}',$6,$7,60,12000,$8,$9)", [booking, randomUUID(), fixture.id, vehicle, service, today, 480 + index * 60, name === "Moe" ? "completed" : "confirmed", attribution]);
      const session = `operations-${name.toLowerCase()}`;
      await query("INSERT INTO wl.events(id,name,session_id,customer_id,booking_id) VALUES($1,'booking_completed',$2,$3,$4)", [randomUUID(), session, name === "Moe" ? null : fixture.id, name === "Dima" ? null : booking]);
      await query("INSERT INTO wl.events(id,name,session_id,customer_id) VALUES($1,'page_view',$2,$3)", [randomUUID(), session, fixture.id]);
      if (name !== "Tony") {
        const external = `operations-archive-${name.toLowerCase()}`;
        await query("INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,status,provider,external_id,metadata,paid_at) VALUES($1,$2,$3,6000,'paid','square',$4,'{\"square_environment\":\"production\"}',now())", [randomUUID(), booking, fixture.id, external]);
        await query("INSERT INTO wl.square_payments(environment,payment_id,status,amount_cents,currency,paid_at) VALUES('production',$1,'COMPLETED',6000,'USD',now())", [external]);
        await query("INSERT INTO wl.events(id,name,session_id,customer_id,booking_id) VALUES($1,'payment_completed',$2,$3,$4)", [randomUUID(), session, fixture.id, booking]);
      }
      fixtures.push({ id: fixture.id, booking, name });
    }
    const [tony, dima, moe] = fixtures;
    await query("INSERT INTO wl.events(id,name,session_id) VALUES($1,'booking_submitted','anonymous-session')", [randomUUID()]);
    const readPreserved = () => Promise.all([
      query("SELECT * FROM wl.bookings ORDER BY id"),
      query("SELECT * FROM wl.payments ORDER BY id"),
      query("SELECT * FROM wl.square_payments ORDER BY payment_id"),
      query("SELECT * FROM wl.revenue_payments ORDER BY id"),
      query("SELECT * FROM wl.events ORDER BY id"),
    ]);
    const finances = (data: Awaited<ReturnType<typeof report>>) => ({
      revenue: data.revenue, payments_collected: data.payments_collected,
      refunds: data.refunds, processor_fees: data.processor_fees, square: data.square,
      expenses: data.expenses, net_operating_profit: data.net_operating_profit, operating_margin: data.operating_margin,
      financial_series: data.financial_series, labor_cost: data.labor_cost, windows: data.windows,
      average_order: data.average_order, revenue_per_customer: data.revenue_per_customer,
      series: data.series, topServices: data.topServices,
      channelRevenue: data.channels.map(row => [row.channel, row.revenue]),
      streamRevenue: data.lead_streams.map(row => [row.lead_stream, row.revenue]),
      campaignRevenue: data.campaigns.map(row => [row.campaign, row.revenue]),
      googlePaidRevenue: data.google_ads.paid_revenue,
    });
    const preserved = await readPreserved(), before = await report(period);
    assert.equal(before.revenue, 12000);
    assert.equal(before.bookings.total, 3);
    assert.equal(before.bookings.completed, 1);
    assert.equal(before.bookings.upcoming, 2);
    assert.equal(before.net_sales, 12000);
    assert.equal(before.outstanding, 6000);
    assert.equal(before.google_ads.booked_value, 36000);
    assert.equal(before.events.find(row => row.name === "booking_completed")?.count, 3);
    assert.equal(before.conversion_rate, 100);
    const beforeDashboard = await adminData("dashboard", period, user);
    assert.ok("today" in beforeDashboard && "unassigned" in beforeDashboard && "operations" in beforeDashboard);
    assert.equal(beforeDashboard.today?.length, 3);
    assert.equal(beforeDashboard.unassigned?.length, 2);
    assert.equal(beforeDashboard.operations?.today_jobs, 3);
    assert.equal(beforeDashboard.operations?.unassigned_jobs, 2);

    await setCustomerArchived(user, change(dima.id));
    await setCustomerArchived(user, change(moe.id));

    for (const role of ["owner", "manager"] as const) {
      const calendar = await adminData("calendar", new URLSearchParams({ date: today }), { ...user, role });
      assert.ok("total" in calendar && "rows" in calendar);
      assert.deepEqual(calendar.rows?.map(row => row.id), [tony.booking]);
      assert.equal(calendar.total, 1);
    }
    const archivedCalendar = await adminData("calendar", new URLSearchParams({ date: today, archived: "1", search: "Dima" }), user);
    assert.ok("total" in archivedCalendar);
    assert.equal(archivedCalendar.total, 0, "the Bookings archive toggle must not expose test jobs on the calendar");
    for (const section of ["dashboard", "marketing", "analytics"]) {
      const dashboard = await adminData(section, period, user);
      assert.ok("today" in dashboard && "unassigned" in dashboard && "operations" in dashboard && "report" in dashboard);
      assert.deepEqual(dashboard.today?.map(row => row.id), [tony.booking]);
      assert.deepEqual(dashboard.unassigned?.map(row => row.id), [tony.booking]);
      assert.equal(dashboard.operations?.today_jobs, 1);
      assert.equal(dashboard.operations?.unassigned_jobs, 1);
      assert.equal(dashboard.report?.bookings.total, 1);
      assert.equal(dashboard.report?.bookings.completed, 0);
      assert.equal(dashboard.report?.bookings.upcoming, 1);
      assert.equal(dashboard.report?.revenue, before.revenue);
    }
    const after = await report(period);
    assert.equal(after.completed_jobs, 0);
    assert.equal(after.net_sales, 0, "archived test jobs do not inflate completed sales");
    assert.equal(after.outstanding, 0, "archived test jobs do not leave operational balances to chase");
    assert.equal(after.google_ads.booked_value, 12000);
    assert.equal(after.google_ads.bookings, 1);
    assert.equal(after.channels.find(row => row.channel === "Google Ads")?.bookings, 1);
    assert.equal(after.channels.find(row => row.channel === "Google Ads")?.clients, 1);
    assert.equal(after.lead_streams.find(row => row.lead_stream === "Dima Leads")?.bookings, 1);
    assert.equal(after.campaigns.find(row => row.campaign === "archive-operations")?.bookings, 1);
    assert.equal(after.events.find(row => row.name === "booking_completed")?.count, 1, "exclude both direct customer and booking-only archived event links");
    assert.ok(Math.abs((after.conversion_rate ?? 0) - 100 / 3) < 0.000001);
    for (const name of ["page_view", "payment_completed", "booking_submitted"])
      assert.deepEqual(after.events.find(row => row.name === name), before.events.find(row => row.name === name), `${name} history remains visible`);
    assert.deepEqual(finances(after), finances(before), "hiding operational appointments must retain every financial total and paid revenue breakdown");
    const schedule = await adminData("schedule", new URLSearchParams({ week: today }), user);
    assert.ok("appointments" in schedule && "workload" in schedule && "shifts" in schedule);
    assert.deepEqual(schedule.appointments?.map(row => row.id), [tony.booking]);
    assert.deepEqual(schedule.workload, [{ booking_date: today, bookings: 1 }]);
    assert.equal(schedule.shifts?.length, 1, "employee shifts are independent of customer archives");
    assert.deepEqual(await readPreserved(), preserved, "no read or archive operation can rewrite booking or payment history");
    await query("INSERT INTO wl.events(id,name,session_id) VALUES($1,'booking_completed','unlinked-session')", [randomUUID()]);
    assert.equal((await report(period)).events.find(row => row.name === "booking_completed")?.count, 2, "unlinked conversion events are retained because they cannot be classified as archived");

    // Assign all three existing appointments to exercise the employee-facing view.
    await query("UPDATE wl.bookings SET assigned_to=$1", [user.user_id]);
    for (const role of ["owner", "staff"] as const) {
      const personal = await adminData("my_schedule", new URLSearchParams(), { ...user, role });
      assert.ok("appointments" in personal && "employee" in personal && "shifts" in personal);
      assert.deepEqual(personal.appointments?.map(row => row.id), [tony.booking]);
      assert.equal(personal.shifts?.length, 1);
    }
    await assert.rejects(() => adminData("calendar", new URLSearchParams({ date: today }), { ...user, role: "staff" }), /access/i);
    await setCustomerArchived(user, change(dima.id, "restore"));
    const restored = await adminData("calendar", new URLSearchParams({ date: today }), user);
    assert.ok("rows" in restored && "total" in restored);
    assert.deepEqual(restored.rows?.map(row => row.id), [tony.booking, dima.booking]);
    assert.equal(restored.total, 2);
    assert.deepEqual(finances(await report(period)), finances(before), "restoring visibility also leaves all financial totals unchanged");
  } finally { await closeDatabase(); }
});

test("archive suppresses campaign audiences and queued marketing without altering transactional history", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw Error("Archived recipient must not contact a provider"); });
  try {
    const user = await owner(), fixture = await customer(), keep = await customer();
    for (const status of ["queued", "skipped", "failed", "sent"])
      await query("INSERT INTO wl.messages(id,dedupe_key,customer_id,channel,recipient,body,purpose,status) VALUES($1,$2,$3,'email',$4,'Promotion','marketing',$2)", [randomUUID(), status, fixture.id, fixture.email]);
    await query("INSERT INTO wl.messages(id,dedupe_key,customer_id,channel,recipient,body,purpose,status) VALUES($1,'receipt',$2,'email',$3,'Receipt','transactional','sent')", [randomUUID(), fixture.id, fixture.email]);
    await setCustomerArchived(user, change(fixture.id));
    for (const channel of ["email", "sms"])
      assert.deepEqual((await transaction(q => audience(q, "all", channel))).map(row => row.id), [keep.id]);
    assert.deepEqual(await query("SELECT dedupe_key,status FROM wl.messages ORDER BY dedupe_key"), [
      { dedupe_key: "failed", status: "cancelled" }, { dedupe_key: "queued", status: "cancelled" },
      { dedupe_key: "receipt", status: "sent" }, { dedupe_key: "sent", status: "sent" }, { dedupe_key: "skipped", status: "cancelled" },
    ]);
    await assert.rejects(() => adminAction("send_message", { customer_id: fixture.id, channel: "email", subject: "Sale", body: "Promotion", purpose: "marketing" }, user), /restore|archiv/i);
    // Simulate an already queued/racing producer after archival; dispatch must recheck the customer.
    const late = randomUUID();
    await query("INSERT INTO wl.messages(id,dedupe_key,customer_id,channel,recipient,body,purpose,status) VALUES($1,'late-promotion',$2,'email',$3,'Promotion','marketing','queued')", [late, fixture.id, fixture.email]);
    await processOutbox();
    assert.equal((await query<{ status: string }>("SELECT status FROM wl.messages WHERE id=$1", [late]))[0].status, "cancelled");
    await setCustomerArchived(user, change(fixture.id, "restore"));
    assert.equal((await query<{ status: string }>("SELECT status FROM wl.messages WHERE id=$1", [late]))[0].status, "cancelled", "restore must not requeue old promotions");
  } finally { await closeDatabase(); }
});

test("Square archives survive imports and customer restore only restores histories archived with that customer", async () => {
  try {
    const user = await owner(), fixture = await customer();
    await importSquareCustomerHistory(csv("IMPORT-LINKED", fixture.email), "fixture.csv", user);
    await history("INDIVIDUAL", fixture.id);
    await history("STANDALONE");
    await setCustomerArchived(user, change("INDIVIDUAL", "archive", "square-profile"));
    await setCustomerArchived(user, change("STANDALONE", "archive", "square-profile"));
    await setCustomerArchived(user, change(fixture.id));
    await assert.rejects(() => setCustomerArchived(user, change("IMPORT-LINKED", "restore", "square-profile")), /customer|archiv/i);
    await importSquareCustomerHistory(csv("IMPORT-LINKED", fixture.email, "Archive", "unsubscribed"), "unsubscribe.csv", user);
    await importSquareCustomerHistory(csv("IMPORT-LINKED", fixture.email), "fixture.csv", user);
    assert.equal((await query<{ marketing_email: boolean }>("SELECT marketing_email FROM wl.customers WHERE id=$1", [fixture.id]))[0].marketing_email, false, "an explicit unsubscribe received while archived still applies and cannot be reversed by an undated subscribed snapshot");
    await importSquareCustomerHistory(csv("IMPORT-LINKED", "new-contact@example.test", "Updated source name"), "updated.csv", user);
    await importSquareCustomerHistory(csv("STANDALONE", "brand-new@example.test"), "standalone.csv", user);
    assert.equal((await query("SELECT * FROM wl.customers")).length, 1, "an archived history must not create another active customer when reimported with new contact details");
    const linked = (await query<{ customer_id: string; archived_at: unknown }>("SELECT customer_id,archived_at FROM wl.square_customer_history WHERE square_customer_id='IMPORT-LINKED'"))[0];
    assert.equal(linked.customer_id, fixture.id, "reimport preserves archived profile customer linkage");
    assert.ok(linked.archived_at);
    assert.equal((await squareCustomerHistory(user)).summary.profiles, 0);
    assert.equal((await squareCustomerHistory(user, 1, "", true)).summary.profiles, 3);
    assert.equal((await exportSquareCustomerHistory(user)).split("\r\n").length, 1, "active export omits archived contacts");
    assert.equal(parseSquareCustomerHistory(await exportSquareCustomerHistory(user, true)).rows.length, 3);
    await setCustomerArchived(user, change(fixture.id, "restore"));
    assert.equal((await query<{ marketing_email: boolean }>("SELECT marketing_email FROM wl.customers WHERE id=$1", [fixture.id]))[0].marketing_email, false, "restoring the contact preserves the new opt-out");
    assert.deepEqual((await squareCustomerHistory(user)).rows.map(row => row.square_customer_id), ["IMPORT-LINKED"]);
    assert.equal((await squareCustomerHistory(user, 1, "", true)).summary.profiles, 2, "individual archives are not restored by customer restoration");
    await setCustomerArchived(user, change("STANDALONE", "restore", "square-profile"));
    assert.equal((await squareCustomerHistory(user)).summary.profiles, 2);
  } finally { await closeDatabase(); }
});

test("a new Square profile matching an archived contact inherits its archive without creating another customer", async () => {
  try {
    const user = await owner(), fixture = await customer();
    await setCustomerArchived(user, change(fixture.id));
    await importSquareCustomerHistory(csv("NEW-SQUARE-ID", fixture.email), "new-profile.csv", user);
    const row = (await query<{ customer_id: string; archived_at: unknown; archived_customer_id: string }>("SELECT customer_id,archived_at,archived_customer_id FROM wl.square_customer_history WHERE square_customer_id='NEW-SQUARE-ID'"))[0];
    assert.equal(row.customer_id, fixture.id);
    assert.equal(row.archived_customer_id, fixture.id);
    assert.ok(row.archived_at);
    assert.equal((await query("SELECT * FROM wl.customers")).length, 1);
    assert.equal((await squareCustomerHistory(user)).summary.profiles, 0);
    await setCustomerArchived(user, change(fixture.id, "restore"));
    assert.equal((await squareCustomerHistory(user)).summary.profiles, 1);
  } finally { await closeDatabase(); }
});

test("archive is restricted to owners/admins and endpoint enforces session, origin and validated identifiers", async () => {
  try {
    const user = await owner(), fixture = await customer();
    for (const role of ["manager", "staff"] as const)
      await assert.rejects(() => setCustomerArchived({ ...user, role }, change(fixture.id)), /owner|admin|access/i);
    await assert.rejects(() => setCustomerArchived(user, change(randomUUID())), /not found/i);
    const request = (body: unknown, cookie = "", origin = "https://example.test") => new Request("https://example.test/api/admin/customer-archive", {
      method: "POST", headers: { origin, cookie, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    assert.equal((await POST(request(change(fixture.id)))).status, 401);
    const token = "b".repeat(64);
    await query("INSERT INTO wl.sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [hash(token), user.user_id]);
    assert.equal((await POST(request(change(fixture.id), `wl_session=${token}`, "https://other.example"))).status, 403);
    assert.equal((await POST(request(change("not-a-uuid"), `wl_session=${token}`))).status, 400);
    const result = await POST(request(change(fixture.id), `wl_session=${token}`));
    assert.equal(result.status, 200);
    assert.equal((await result.json()).archived, true);
  } finally { await closeDatabase(); }
});
