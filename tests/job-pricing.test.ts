import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { query, closeDatabase } from "../lib/platform/db";
import { saveJobPricing } from "../lib/platform/job-pricing";
import { adminAction } from "../lib/platform/admin";
import { payrollSummary } from "../lib/platform/payroll";
import type { Session } from "../lib/platform/types";

process.env.PGLITE_PATH = "memory://job-pricing";
Object.assign(process.env, { NODE_ENV: "test", SQUARE_ENVIRONMENT: "production", SQUARE_ACCESS_TOKEN: "pricing-fixture-token" });
delete process.env.DATABASE_URL;
delete process.env.RAILWAY_ENVIRONMENT;
after(closeDatabase);

async function fixture(assigned = true) {
  const actor = randomUUID(), customer = randomUUID(), vehicle = randomUUID(), id = randomUUID(), employee = randomUUID(), base = randomUUID(), upgrade = randomUUID();
  const services = await query<{ id: string; name: string }>("SELECT id,name FROM wl.services ORDER BY id LIMIT 2");
  const service = services[0].id;
  const session: Session = { id: randomUUID(), user_id: actor, name: "Pricing manager", email: `${actor}@example.test`, role: "manager" };
  await query("INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,$2,$3,'fixture','manager')", [actor, session.name, session.email]);
  await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone) VALUES($1,'Price','Fixture',$2,'')", [customer, `${customer}@example.test`]);
  await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Test','Car',2026,'Sedan')", [vehicle, customer]);
  await query("INSERT INTO wl.employees(id,name,position,compensation_model,default_commission_bps) VALUES($1,'Pricing detailer','Detailer','commission',3000)", [employee]);
  const snapshot = { id: service, name: "Full detail", requires_quote: false, selected_services: [{ id: service, name: "Full detail", base_cents: 40000, total_cents: 55000, selected_addons: [{ id: "sealant", line_item_id: upgrade, name: "Sealant", description: "Protection", priceCents: 15000 }] }] };
  await query(`INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,status,price_cents,deposit_cents,tip_cents)
    VALUES($1::uuid,$1::text,'fixture',$1::text,$2,$3,$4,'Full detail',$5::jsonb,'2026-10-26',600,120,'completed',55000,20000,7500)`, [id, customer, vehicle, service, JSON.stringify(snapshot)]);
  await query("INSERT INTO wl.booking_line_items(id,booking_id,service_id,kind,name,quantity,unit_price_cents) VALUES($1,$2,$3,'base_service','Full detail',1,40000),($4,$2,$3,'upsell','Sealant',1,15000)", [base, id, service, upgrade]);
  await query("INSERT INTO wl.payments(id,booking_id,customer_id,amount_cents,status,kind) VALUES($1,$2,$3,20000,'paid','deposit')", [randomUUID(), id, customer]);
  if (assigned) await query("INSERT INTO wl.employee_job_assignments(id,booking_id,employee_id,pool_share_bps,line_pay_rules) VALUES($1,$2,$3,10000,$4::jsonb)", [randomUUID(), id, employee, JSON.stringify([
    { line_item_id: base, pay_type: "percentage", pay_value: 4000 }, { line_item_id: upgrade, pay_type: "percentage", pay_value: 5000 },
  ])]);
  const input = { booking_id: id, items: [
    { id: base, service_id: service, kind: "base_service" as const, name: "Full detail", quantity: 1, unit_price_cents: 40000 as number | null },
    { id: upgrade, service_id: service, kind: "upsell" as const, name: "Sealant", quantity: 1, unit_price_cents: 15000 as number | null },
  ], discounts: [] as Array<{kind:"fixed"|"percent";value:number;reason:string}>, deposit_cents: 20000 };
  return { id, actor, customer, employee, base, upgrade, service, services, input, session };
}

test("agreed service prices and discounts save atomically while deposits, tips and per-line pay remain independent", async () => {
  const f = await fixture();
  const lineIds = await query("SELECT id FROM wl.booking_line_items WHERE booking_id=$1 ORDER BY id", [f.id]);
  await adminAction("save_job_pricing", { ...f.input, discounts: [{ kind: "percent", value: 1000, reason: "Loyalty" }] }, f.session);
  assert.deepEqual(await query("SELECT price_cents,deposit_cents,tip_cents FROM wl.bookings WHERE id=$1", [f.id]), [{ price_cents: 49500, deposit_cents: 20000, tip_cents: 7500 }]);
  assert.deepEqual(await query("SELECT kind,value,amount_cents FROM wl.booking_discounts WHERE booking_id=$1", [f.id]), [{ kind: "percent", value: 1000, amount_cents: 5500 }]);
  assert.deepEqual(await query("SELECT id FROM wl.booking_line_items WHERE booking_id=$1 ORDER BY id", [f.id]), lineIds);
  assert.equal(Number((await payrollSummary("2026-10-26", "2026-10-26")).find(row => row.id === f.employee)!.commission_cents), 21150);
  assert.equal(Number((await query("SELECT amount_cents FROM wl.payments WHERE booking_id=$1", [f.id]))[0].amount_cents), 20000);
  const before = await query("SELECT * FROM wl.bookings WHERE id=$1", [f.id]);
  const previousDiscounts = await query("SELECT * FROM wl.booking_discounts WHERE booking_id=$1", [f.id]);
  await assert.rejects(() => saveJobPricing({ ...f.input, discounts: [{ kind: "fixed", value: 100000, reason: "Too large" }] }, f.actor), /greater than/);
  assert.deepEqual(await query("SELECT * FROM wl.bookings WHERE id=$1", [f.id]), before);
  assert.deepEqual(await query("SELECT * FROM wl.booking_discounts WHERE booking_id=$1", [f.id]), previousDiscounts);
  await assert.rejects(() => saveJobPricing({ ...f.input, items: [f.input.items[0]] }, f.actor), /pay override/);
  assert.deepEqual(await query("SELECT id FROM wl.booking_line_items WHERE booking_id=$1 ORDER BY id", [f.id]), lineIds);
});

test("resolving a quote updates every line and service snapshot without retaining by-quote labels", async () => {
  const f = await fixture(false);
  await query("UPDATE wl.bookings SET status='new',price_cents=NULL,deposit_cents=0,service_snapshot=jsonb_set(jsonb_set(service_snapshot,'{requires_quote}','true'),'{selected_services,0,base_cents}','null') WHERE id=$1", [f.id]);
  await query("UPDATE wl.booking_line_items SET quote_pending=true,unit_price_cents=0,name=name||' · By quote' WHERE booking_id=$1", [f.id]);
  const items = f.input.items.map(item => ({ ...item, name: item.name + " · By quote" }));
  await saveJobPricing({ ...f.input, items, deposit_cents: 0 }, f.actor);
  const booking = (await query<{ price_cents: number; service_name: string; service_snapshot: any }>("SELECT price_cents,service_name,service_snapshot FROM wl.bookings WHERE id=$1", [f.id]))[0];
  assert.equal(booking.price_cents, 55000);
  assert.equal(booking.service_name, "Full detail");
  assert.equal(booking.service_snapshot.requires_quote, false);
  assert.equal(booking.service_snapshot.agreed_total_cents, 55000);
  assert.equal(booking.service_snapshot.selected_services[0].base_cents, 40000);
  assert.equal(booking.service_snapshot.selected_services[0].total_cents, 55000);
  assert.equal(booking.service_snapshot.selected_services[0].selected_addons[0].priceCents, 15000);
  assert.equal(booking.service_snapshot.selected_services[0].selected_addons[0].line_item_id, f.upgrade);
  assert.equal((await query("SELECT id FROM wl.booking_line_items WHERE booking_id=$1 AND (quote_pending OR name ILIKE '%by quote%')", [f.id])).length, 0);
});

test("adding and removing services rebuilds the customer-facing service name and selected-service snapshot", async () => {
  const f = await fixture(false), next = f.services[1];
  await saveJobPricing({ ...f.input, items: [...f.input.items, { service_id: next.id, kind: "base_service", name: "Paint correction", quantity: 1, unit_price_cents: 30000 }] }, f.actor);
  const first = (await query<{ service_name: string; service_snapshot: any }>("SELECT service_name,service_snapshot FROM wl.bookings WHERE id=$1", [f.id]))[0];
  assert.equal(first.service_name, "Full detail + Paint correction");
  assert.deepEqual(first.service_snapshot.selected_services.map((service: {id:string}) => service.id), [f.service, next.id]);
  const added = (await query<{id:string}>("SELECT id FROM wl.booking_line_items WHERE booking_id=$1 AND service_id=$2", [f.id, next.id]))[0];
  await assert.rejects(() => saveJobPricing({ ...f.input, items: [f.input.items[1], { id: added.id, service_id: next.id, kind: "base_service", name: "Paint correction", quantity: 1, unit_price_cents: 30000 }] }, f.actor), /upgrade still belongs/);
  await saveJobPricing({ ...f.input, items: [{ id: added.id, service_id: next.id, kind: "base_service", name: "Custom correction", quantity: 1, unit_price_cents: 30000 }] }, f.actor);
  const second = (await query<{ service_id: string; service_name: string; service_snapshot: any }>("SELECT service_id,service_name,service_snapshot FROM wl.bookings WHERE id=$1", [f.id]))[0];
  assert.equal(second.service_id, next.id);
  assert.equal(second.service_name, "Custom correction");
  assert.deepEqual(second.service_snapshot.selected_services.map((service: {id:string}) => service.id), [next.id]);
  assert.equal(second.service_snapshot.selected_services[0].total_cents, 30000);
  assert.deepEqual(second.service_snapshot.selected_services[0].selected_addons, []);
});

test("foreign line IDs, stale editor versions and unauthorized staff cannot modify job prices", async () => {
  const f = await fixture(), other = await fixture();
  const before = await query("SELECT * FROM wl.bookings WHERE id=$1", [f.id]);
  await assert.rejects(() => saveJobPricing({ ...f.input, items: [{ ...f.input.items[0], id: other.base }, f.input.items[1]] }, f.actor), /does not belong/);
  await assert.rejects(() => saveJobPricing({ ...f.input, expected_updated_at: "2000-01-01T00:00:00Z" }, f.actor), /changed while/);
  await assert.rejects(() => adminAction("save_job_pricing", f.input, { ...f.session, role: "staff" }), error => error instanceof Error && "status" in error && error.status === 403);
  await assert.rejects(() => adminAction("save_job_compensation", {}, { ...f.session, role: "staff" }), error => error instanceof Error && "status" in error && error.status === 403);
  assert.deepEqual(await query("SELECT * FROM wl.bookings WHERE id=$1", [f.id]), before);
});

test("an unchanged browser timestamp retains milliseconds while a genuinely stale price editor is rejected", async () => {
  const f = await fixture(false);
  await query("UPDATE wl.bookings SET updated_at='2026-11-05T12:34:56.123456Z'::timestamptz WHERE id=$1", [f.id]);
  const row = (await query<{ updated_at: Date }>("SELECT updated_at FROM wl.bookings WHERE id=$1", [f.id]))[0];
  assert.ok(row.updated_at instanceof Date);
  const browser = JSON.parse(JSON.stringify(row)) as { updated_at: string };
  assert.equal(browser.updated_at, "2026-11-05T12:34:56.123Z");
  await saveJobPricing({ ...f.input, expected_updated_at: browser.updated_at }, f.actor);
  await query("UPDATE wl.bookings SET updated_at='2026-11-05T12:34:57.123456Z'::timestamptz WHERE id=$1", [f.id]);
  const before = await query("SELECT * FROM wl.bookings WHERE id=$1", [f.id]);
  await assert.rejects(() => saveJobPricing({ ...f.input, expected_updated_at: browser.updated_at }, f.actor), /changed while/);
  assert.deepEqual(await query("SELECT * FROM wl.bookings WHERE id=$1", [f.id]), before);
});

test("saving unchanged quoted lines does not cancel an existing Square invoice", async () => {
  const f = await fixture(false);
  await query("UPDATE wl.bookings SET status='new',price_cents=NULL,deposit_cents=0 WHERE id=$1", [f.id]);
  await query("UPDATE wl.booking_line_items SET quote_pending=true,unit_price_cents=0 WHERE id=$1", [f.base]);
  await query("INSERT INTO wl.square_invoices(booking_id,environment,request_id,invoice_id,amount_cents,status) VALUES($1,'production','fixture','sq-pricing-noop',55000,'UNPAID')", [f.id]);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error("No Square operation expected"); };
  try {
    await saveJobPricing({ ...f.input, items: [{ ...f.input.items[0], unit_price_cents: null }, f.input.items[1]], deposit_cents: 0 }, f.actor);
    assert.equal(calls, 0);
    assert.deepEqual(await query("SELECT retired_at,status FROM wl.square_invoices WHERE booking_id=$1", [f.id]), [{ retired_at: null, status: "UNPAID" }]);
  } finally { globalThis.fetch = originalFetch; }
});

test("paid payroll protects job prices for both modern and legacy single assignments", async () => {
  const f = await fixture(), legacy = await fixture(false);
  await query("UPDATE wl.employees SET user_id=$2 WHERE id=$1", [legacy.employee, legacy.actor]);
  await query("UPDATE wl.bookings SET assigned_to=$2 WHERE id=$1", [legacy.id, legacy.actor]);
  const period = randomUUID();
  await query("INSERT INTO wl.pay_periods(id,start_date,end_date,status) VALUES($1,'2026-10-26','2026-10-26','paid')", [period]);
  for (const job of [f, legacy]) {
    await query("INSERT INTO wl.payroll_records(id,pay_period_id,employee_id,hourly_rate_cents,estimated_gross_cents) VALUES($1,$2,$3,0,20000)", [randomUUID(), period, job.employee]);
    await assert.rejects(() => saveJobPricing({ ...job.input, discounts: [{ kind: "fixed", value: 100, reason: "Late change" }] }, job.actor), /paid payroll period/);
    assert.equal(Number((await query("SELECT price_cents FROM wl.bookings WHERE id=$1", [job.id]))[0].price_cents), 55000);
  }
});
