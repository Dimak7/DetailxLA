import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { archiveTestData, restoreTestData, testDataCleanupPreview } from "../lib/platform/test-data-cleanup";
import { query, closeDatabase } from "../lib/platform/db";
import { importMetaLead } from "../lib/integrations/meta-leads";
import type { Session } from "../lib/platform/types";
Object.assign(process.env, { NODE_ENV: "test", PGLITE_PATH: "memory://test-data-cleanup" });
for (const key of ["DATABASE_URL", "RAILWAY_ENVIRONMENT", "ADMIN_EMAIL", "ADMIN_PASSWORD", "SQUARE_ACCESS_TOKEN", "STRIPE_SECRET_KEY", "EMAIL_PROVIDER_API_KEY", "RESEND_API_KEY", "TELEGRAM_BOT_TOKEN", "TWILIO_AUTH_TOKEN"])
  delete process.env[key];
async function owner(): Promise<Session> {
  const id = randomUUID();
  await query("INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,'Test owner',$2,'fixture','owner')", [id, `${id}@example.test`]);
  return { id: "fixture", user_id: id, name: "Test owner", email: `${id}@example.test`, role: "owner" };
}
async function customer(name = "Test customer") {
  const id = randomUUID(), vehicle = randomUUID(), booking = randomUUID(), attribution = randomUUID(), lead = randomUUID();
  const service = (await query<{ id: string }>("SELECT id FROM wl.services ORDER BY sort_order LIMIT 1"))[0].id;
  await query("INSERT INTO wl.attributions(id,session_id,source) VALUES($1,$2,'Direct')", [attribution, randomUUID()]);
  await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone,attribution_id) VALUES($1,$2,'Fixture',$3,'3125550124',$4)", [id, name, `${id}@example.test`, attribution]);
  await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Fixture','Coupe',2026,'Sedan')", [vehicle, id]);
  await query("INSERT INTO wl.leads(id,name,customer_id,attribution_id) VALUES($1,'Test lead',$2,$3)", [lead, id, attribution]);
  await query("INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,price_cents,attribution_id,lead_id) VALUES($1,$2,'fixture',$2,$3,$4,$5,'Detail','{}','2026-10-15',480,60,10000,$6,$7)", [booking, randomUUID(), id, vehicle, service, attribution, lead]);
  return { id, vehicle, booking, attribution, lead, service };
}
const selection = (id: string) => ({ customers: [id], leads: [], confirm_test_data: true });

test("selected test records archive atomically and restore all linked history without sending old messages", async () => {
  try {
    const user = await owner(), fixture = await customer(), real = await customer("Real customer");
    await query("INSERT INTO wl.timeline(id,customer_id,booking_id,lead_id,type,body) VALUES($1,$2,$3,$4,'fixture','Preserve this history')", [randomUUID(), fixture.id, fixture.booking, fixture.lead]);
    await query("INSERT INTO wl.consent_events(id,customer_id,channel,consent,wording,source) VALUES($1,$2,'email',false,'Fixture','test')", [randomUUID(), fixture.id]);
    await query("INSERT INTO wl.events(id,name,customer_id,booking_id,attribution_id) VALUES('cleanup-test-event','booking_created',$1,$2,$3)", [fixture.id, fixture.booking, fixture.attribution]);
    await query("INSERT INTO wl.booking_line_items(id,booking_id,kind,name,quantity,unit_price_cents) VALUES($1,$2,'base_service','Detail',1,10000)", [randomUUID(), fixture.booking]);
    await query("INSERT INTO wl.booking_discounts(id,booking_id,kind,value,amount_cents) VALUES($1,$2,'fixed',100,100)", [randomUUID(), fixture.booking]);
    const employee = randomUUID();
    await query("INSERT INTO wl.employees(id,name) VALUES($1,'Fixture employee')", [employee]);
    await query("INSERT INTO wl.employee_job_assignments(id,employee_id,booking_id) VALUES($1,$2,$3)", [randomUUID(), employee, fixture.booking]);
    const tag = (await query<{ id: string }>("SELECT id FROM wl.crm_tags LIMIT 1"))[0].id;
    await query("INSERT INTO wl.customer_tags(customer_id,tag_id) VALUES($1,$2)", [fixture.id, tag]);
    await query("INSERT INTO wl.lead_tags(lead_id,tag_id) VALUES($1,$2)", [fixture.lead, tag]);
    await query("INSERT INTO wl.messages(id,dedupe_key,customer_id,booking_id,channel,recipient,body,status) VALUES($1,'test-queued',$2,$3,'email','fixture@example.test','Test','queued')", [randomUUID(), fixture.id, fixture.booking]);
    await query("INSERT INTO wl.reviews(id,customer_id,booking_id,name) VALUES($1,$2,$3,'Test')", [randomUUID(), fixture.id, fixture.booking]);
    const original = await query("SELECT * FROM wl.bookings WHERE id=$1", [fixture.booking]);
    const archive = await archiveTestData(selection(fixture.id), user);
    assert.equal((await query("SELECT id FROM wl.customers WHERE id=$1", [fixture.id])).length, 0);
    assert.equal((await query("SELECT id FROM wl.bookings WHERE id=$1", [fixture.booking])).length, 0);
    assert.equal((await query("SELECT id FROM wl.events WHERE id='cleanup-test-event'")).length, 0);
    assert.equal((await query("SELECT id FROM wl.attributions WHERE id=$1", [fixture.attribution])).length, 0);
    assert.equal((await query("SELECT id FROM wl.customers WHERE id=$1", [real.id])).length, 1);
    const stored = (await query<{ snapshot: { tables: Record<string, unknown[]> } }>("SELECT snapshot FROM wl.test_data_archives WHERE id=$1", [archive.id]))[0].snapshot;
    for (const table of ["customers", "vehicles", "leads", "bookings", "timeline", "events", "attributions", "consent_events", "messages", "reviews", "customer_tags", "lead_tags", "booking_line_items", "booking_discounts", "employee_job_assignments"])
      assert.equal(stored.tables[table].length, 1, `${table} is included in the recovery snapshot`);
    await restoreTestData(archive, user);
    assert.deepEqual(await query("SELECT * FROM wl.bookings WHERE id=$1", [fixture.booking]), original);
    assert.equal((await query<{ status: string }>("SELECT status FROM wl.messages WHERE dedupe_key='test-queued'"))[0].status, "cancelled");
    await restoreTestData(archive, user);
    assert.equal((await query("SELECT id FROM wl.bookings WHERE id=$1", [fixture.booking])).length, 1, "restore is idempotent");
  } finally { await closeDatabase(); }
});

test("financial, payroll and external histories remain protected and roles cannot bypass review", async () => {
  try {
    const user = await owner();
    const protectors = [
      async (c: Awaited<ReturnType<typeof customer>>) => { await query("INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,status) VALUES($1,$2,$3,100,'pending')", [randomUUID(), c.booking, c.id]); },
      async (c: Awaited<ReturnType<typeof customer>>) => { await query("INSERT INTO wl.square_invoices(booking_id,environment,request_id,amount_cents) VALUES($1,'production','fixture',100)", [c.booking]); },
      async (c: Awaited<ReturnType<typeof customer>>) => { await query("INSERT INTO wl.square_customer_history(square_customer_id,customer_id,transaction_count,lifetime_spend_cents,source_filename,source_hash) VALUES($1,$2,1,100,'fixture.csv','fixture')", [randomUUID(), c.id]); },
      async (c: Awaited<ReturnType<typeof customer>>) => { await query("INSERT INTO wl.marketing_commission_approvals(booking_id,lead_stream,rate_bps,basis_cents,approved_by) VALUES($1,'Business Google · 10%',1000,10000,$2)", [c.booking, user.user_id]); },
      async (c: Awaited<ReturnType<typeof customer>>) => {
        const period = randomUUID(), employee = randomUUID();
        await query("INSERT INTO wl.employees(id,name,user_id) VALUES($1,'Paid worker',$2)", [employee, user.user_id]);
        await query("INSERT INTO wl.pay_periods(id,start_date,end_date,status) VALUES($1,'2026-10-01','2026-10-31','paid')", [period]);
        await query("INSERT INTO wl.payroll_records(id,pay_period_id,employee_id,hourly_rate_cents) VALUES($1,$2,$3,2500)", [randomUUID(), period, employee]);
        await query("UPDATE wl.bookings SET assigned_to=$2 WHERE id=$1", [c.booking, user.user_id]);
      },
    ];
    for (const protect of protectors) {
      const c = await customer(); await protect(c);
      await assert.rejects(archiveTestData(selection(c.id), user), /protected/);
      assert.equal((await query("SELECT id FROM wl.customers WHERE id=$1", [c.id])).length, 1);
    }
    const preview = await testDataCleanupPreview(user);
    assert.ok(preview.customers.every(record => record.blocked_reason));
    const clean = await customer();
    await assert.rejects(archiveTestData(selection(clean.id), { ...user, role: "manager" }), /Only owners/);
    await assert.rejects(testDataCleanupPreview({ ...user, role: "staff" }), /Only owners/);
    await assert.rejects(archiveTestData({ customers: [clean.id], confirm_test_data: false }, user));
    assert.equal((await query("SELECT id FROM wl.test_data_archives")).length, 0);
  } finally { await closeDatabase(); }
});

test("archived Meta test leads retain a processed tombstone and restore the original external link", async () => {
  try {
    const user = await owner(), lead = randomUUID(), attr = randomUUID();
    await query("INSERT INTO wl.attributions(id,session_id) VALUES($1,$2)", [attr, randomUUID()]);
    await query("INSERT INTO wl.leads(id,name,email,origin,attribution_id) VALUES($1,'<test lead: dummy data for full_name>','test@meta.com','meta',$2)", [lead, attr]);
    await query("INSERT INTO wl.meta_lead_events(leadgen_id,page_id,form_id,lead_id,imported_at) VALUES('123456','1234567','12345678',$1,now())", [lead]);
    await query("INSERT INTO wl.events(id,name,attribution_id) VALUES('meta-lead:123456','lead_created',$1)", [attr]);
    await query("INSERT INTO wl.messages(id,dedupe_key,channel,recipient,body) VALUES($1,'meta-lead:123456:telegram','telegram','fixture','Test')", [randomUUID()]);
    const archive = await archiveTestData({ customers: [], leads: [lead], confirm_test_data: true }, user);
    const tombstone = (await query<{ lead_id: string | null; imported_at: string }>("SELECT lead_id,imported_at FROM wl.meta_lead_events WHERE leadgen_id='123456'"))[0];
    assert.equal(tombstone.lead_id, null); assert.ok(tombstone.imported_at);
    assert.equal(await importMetaLead({ leadgen_id: "123456", page_id: "1234567", form_id: "12345678" }, { id: "123456", form_id: "12345678", field_data: [] }), false);
    assert.equal((await query("SELECT id FROM wl.leads WHERE id=$1", [lead])).length, 0);
    await restoreTestData(archive, user);
    assert.equal((await query<{ lead_id: string }>("SELECT lead_id FROM wl.meta_lead_events WHERE leadgen_id='123456'"))[0].lead_id, lead);
    assert.equal((await query<{ status: string }>("SELECT status FROM wl.messages WHERE dedupe_key='meta-lead:123456:telegram'"))[0].status, "cancelled");
  } finally { await closeDatabase(); }
});

test("unknown foreign keys and restore conflicts roll back without losing the snapshot or live data", async () => {
  try {
    const user = await owner(), c = await customer();
    await query("CREATE TABLE wl.future_reference(customer_id uuid REFERENCES wl.customers(id))");
    await query("INSERT INTO wl.future_reference(customer_id) VALUES($1)", [c.id]);
    await assert.rejects(archiveTestData(selection(c.id), user));
    assert.equal((await query("SELECT id FROM wl.test_data_archives")).length, 0);
    assert.equal((await query("SELECT id FROM wl.bookings WHERE id=$1", [c.booking])).length, 1);
    await query("DELETE FROM wl.future_reference");
    const archive = await archiveTestData(selection(c.id), user);
    const replacement = randomUUID();
    await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone) VALUES($1,'Replacement','record',$2,'3125550124')", [replacement, `${c.id}@example.test`]);
    await assert.rejects(restoreTestData(archive, user));
    assert.equal((await query<{ restored_at: string | null }>("SELECT restored_at FROM wl.test_data_archives WHERE id=$1", [archive.id]))[0].restored_at, null);
    assert.equal((await query("SELECT id FROM wl.customers WHERE id=$1", [replacement])).length, 1);
    assert.equal((await query("SELECT id FROM wl.attributions WHERE id=$1", [c.attribution])).length, 0, "partial restore rolled back");
  } finally { await closeDatabase(); }
});

test("only externally verified sandbox payments can follow test bookings into a recoverable archive", async () => {
  try {
    const user = await owner(), c = await customer(), paymentId = randomUUID();
    await query("INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,status,provider,external_id,metadata) VALUES($1,$2,$3,5000,'paid','square','verified-sandbox','{\"square_environment\":\"sandbox\"}')", [paymentId, c.booking, c.id]);
    await assert.rejects(archiveTestData(selection(c.id), user), /protected/, "a local sandbox label alone is not sufficient proof");
    await query("INSERT INTO wl.square_payments(environment,payment_id,status,amount_cents,currency) VALUES('production','verified-sandbox','COMPLETED',5000,'USD')");
    await assert.rejects(archiveTestData(selection(c.id), user), /protected/, "production proof never qualifies");
    await query("DELETE FROM wl.square_payments WHERE payment_id='verified-sandbox'");
    await query("INSERT INTO wl.square_payments(environment,payment_id,status,amount_cents,currency) VALUES('sandbox','verified-sandbox','COMPLETED',5000,'USD')");
    const original = await query("SELECT * FROM wl.payments WHERE id=$1", [paymentId]);
    const canonical = await query("SELECT * FROM wl.square_payments WHERE payment_id='verified-sandbox'");
    assert.equal((await testDataCleanupPreview(user)).customers[0].blocked_reason, "");
    const archive = await archiveTestData(selection(c.id), user);
    assert.equal((await query("SELECT id FROM wl.payments WHERE id=$1", [paymentId])).length, 0);
    assert.deepEqual(await query("SELECT * FROM wl.square_payments WHERE payment_id='verified-sandbox'"), canonical, "canonical sandbox ledger remains unchanged");
    await restoreTestData(archive, user);
    assert.deepEqual(await query("SELECT * FROM wl.payments WHERE id=$1", [paymentId]), original);
  } finally { await closeDatabase(); }
});
