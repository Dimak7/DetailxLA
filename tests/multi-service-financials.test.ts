import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { database, query, closeDatabase } from "../lib/platform/db";
import { payrollSummary } from "../lib/platform/payroll";
import { adminAction, adminData } from "../lib/platform/admin";
import { bookingReceipt } from "../lib/platform/receipts";
import { bookingById } from "../lib/platform/bookings";
import { createCheckout } from "../lib/integrations/payments";
import { confirmationView } from "../components/westloop/booking-confirmation-state";
import type { BookingSnapshot, Session } from "../lib/platform/types";

process.env.PGLITE_PATH = "memory://multi-service-financials";
delete process.env.DATABASE_URL;
delete process.env.RAILWAY_ENVIRONMENT;
Object.assign(process.env, {
  NODE_ENV: "test", ADMIN_SESSION_SECRET: "multi-service-test-only-secret-32-characters",
  SQUARE_ACCESS_TOKEN: "test-only-token", SQUARE_LOCATION_ID: "test-only-location",
  SQUARE_WEBHOOK_SIGNATURE_KEY: "test-only-signature", SQUARE_ENVIRONMENT: "production",
});

test("multi-service receipts, invoices, admin prices and payroll keep service amounts separate", async (t) => {
  await database();
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network request"); });
  try {
    const services = await query<{ id: string; name: string }>("SELECT id,name FROM wl.services ORDER BY id LIMIT 2");
    const first = services[0].id, second = services[1].id;
    const customer = randomUUID(), vehicle = randomUUID();
    const owner: Session = { id: randomUUID(), user_id: randomUUID(), name: "Owner", email: "owner@test.local", role: "owner" };
    await query("INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,'Owner','multi-owner@test.local','unused','owner')", [owner.user_id]);
    await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone) VALUES($1,'Multi','Service','multi@test.local','')", [customer]);
    await query("INSERT INTO wl.vehicles(id,customer_id,make,model,year,type) VALUES($1,$2,'Porsche','911',2026,'Sedan')", [vehicle,customer]);
    async function booking(price: number | null, unknown = false, status = "completed") {
      const id = randomUUID(), firstLine = randomUUID(), secondLine = randomUUID();
      const snapshot = { id: first, slug: "full-detail", pricing_mode: "fixed", requires_quote: unknown, selected_services: [
        { id: first, name: "Full detail", slug: "full-detail", pricing_mode: "fixed", base_cents: 10000, total_cents: 10000 },
        { id: second, name: "Ceramic coating", slug: "ceramic-coating", pricing_mode: unknown ? "quote" : "fixed", base_cents: unknown ? null : 20000, total_cents: unknown ? null : 20000 },
      ] };
      await query("INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,status,price_cents,deposit_cents) VALUES($1,$2,'test',$3,$4,$5,$6,'Full detail + Ceramic coating',$7::jsonb,'2030-09-20',480,600,$8,$9,0)", [id,randomUUID(),`MULTI-${id.slice(0,8)}`,customer,vehicle,first,JSON.stringify(snapshot),status,price]);
      await query("INSERT INTO wl.booking_line_items(id,booking_id,service_id,kind,name,quantity,unit_price_cents) VALUES($1,$2,$3,'base_service','Full detail',1,10000),($4,$2,$5,'base_service','Ceramic coating',1,$6)", [firstLine,id,first,secondLine,second,unknown ? 0 : 20000]);
      return { id,firstLine,secondLine };
    }
    async function employee(model: string, commission = 3000, flat = 5000) {
      const id = randomUUID();
      await query("INSERT INTO wl.employees(id,name,email,phone,position,compensation_model,default_commission_bps,flat_job_pay_cents,active) VALUES($1,$2,$3,'','Detailer',$4,$5,$6,true)", [id,`Multi ${id}`,`${id}@test.local`,model,commission,flat]);
      return id;
    }
    async function rule(id: string, service: string | null, type: string, value: number) {
      await query("INSERT INTO wl.employee_pay_rules(id,employee_id,service_id,rule_type,value,active) VALUES($1,$2,$3,$4,$5,true)", [randomUUID(),id,service,type,value]);
    }
    async function assignedJob(id: string) {
      const job = await booking(28800);
      await query("INSERT INTO wl.booking_line_items(id,booking_id,service_id,kind,name,quantity,unit_price_cents) VALUES($1,$2,$3,'upsell','Extra care',1,2000)", [randomUUID(),job.id,first]);
      await query("INSERT INTO wl.employee_job_assignments(id,booking_id,employee_id,pool_share_bps) VALUES($1,$2,$3,10000)", [randomUUID(),job.id,id]);
      return job;
    }
    const percent = await employee("commission"), flat = await employee("flat_job"), mixed = await employee("flat_job"), all = await employee("hourly");
    await rule(percent,second,"commission_percent",5000);
    await rule(mixed,second,"flat_job",2000);
    await rule(all,null,"flat_job",4000);
    const percentJob = await assignedJob(percent);
    await assignedJob(flat); await assignedJob(mixed); await assignedJob(all);
    const payroll = await payrollSummary("2030-09-20","2030-09-20");
    assert.equal(Number(payroll.find((row) => row.id === percent)?.commission_cents),12240, "30% of discounted detail+upsell (10800) plus 50% of coating (18000)");
    assert.equal(Number(payroll.find((row) => row.id === flat)?.commission_cents),5000, "The default flat rate applies once per appointment");
    assert.equal(Number(payroll.find((row) => row.id === mixed)?.commission_cents),7000, "A specific flat rule replaces only its own service's default pay");
    assert.equal(Number(payroll.find((row) => row.id === all)?.commission_cents),4000, "An all-services flat rule applies once even with multiple base and upsell lines");
    assert.equal(Number(payroll.find((row) => row.id === percent)?.jobs_completed),1);
    await query("UPDATE wl.employee_job_assignments SET commission_override_cents=777 WHERE booking_id=$1", [percentJob.id]);
    assert.equal(Number((await payrollSummary("2030-09-20","2030-09-20")).find((row) => row.id === percent)?.commission_cents),777, "A final job override still takes precedence");
    t.diagnostic("Service-specific pay uses allocated final revenue; ordinary flat pay and job counts do not multiply");

    const quote = await booking(null,true,"new");
    await adminAction("save_booking_line_item", { booking_id: quote.id, service_id: second, kind: "upsell", name: "Ceramic extra", quantity: 1, unit_price_cents: 500 }, owner);
    assert.equal((await bookingById(quote.id)).price_cents,null, "An upsell cannot price an unknown quote");
    let receipt = (await bookingReceipt(quote.id))!;
    assert.equal(receipt.quoteBased,true);
    assert.deepEqual(receipt.lineItems?.map((item) => item.name).sort(),["Ceramic coating","Ceramic extra","Full detail"]);
    assert.equal(receipt.lineItems?.find((item) => item.id === quote.secondLine)?.totalCents,null);
    assert.equal(confirmationView(receipt).canPay,false);
    await assert.rejects(createCheckout(quote.id),/quote must be agreed/i);
    await adminAction("save_booking_discount", { booking_id: quote.id, kind: "fixed", value: 100, reason: "Agreed discount" }, owner);
    assert.equal((await bookingById(quote.id)).price_cents,null, "Discounts also keep quote pricing unresolved");
    await adminAction("save_booking_line_item", { id: quote.secondLine, booking_id: quote.id, kind: "base_service", name: "Ceramic coating", quantity: 1, unit_price_cents: 25000 }, owner);
    const priced = (await bookingById(quote.id)).service_snapshot as BookingSnapshot;
    assert.equal(priced.selected_services?.find((service) => service.id === second)?.base_cents,25000);
    assert.equal(priced.selected_services?.find((service) => service.id === second)?.total_cents,25500);
    assert.equal((await bookingById(quote.id)).price_cents,null, "Pricing component lines is not approval of the appointment total");
    await adminAction("update_booking", { id: quote.id, price_cents: 35400, status: "confirmed" }, owner);
    receipt = (await bookingReceipt(quote.id))!;
    assert.equal(receipt.priceCents,35400);
    assert.equal(receipt.discountCents,100);
    assert.equal(receipt.lineItems?.find((item) => item.id === quote.secondLine)?.totalCents,25000);
    assert.equal(confirmationView(receipt).canPay,true);
    t.diagnostic("Mixed quote carts stay non-payable through line and discount edits until the full price is approved");

    const knownQuote = await booking(30000,false,"new");
    const knownReceipt = (await bookingReceipt(knownQuote.id))!;
    assert.equal(knownReceipt.quoteBased,true, "A non-primary ceramic service still requires quote approval");
    assert.equal(confirmationView(knownReceipt).canPay,false);
    await assert.rejects(createCheckout(knownQuote.id),/quote must be agreed/i);
    assert.equal((await query("SELECT id FROM wl.payments WHERE booking_id=$1",[knownQuote.id])).length,0);

    const dashboard = await adminData("bookings",new URLSearchParams({ search: "MULTI-" }),owner);
    assert.ok((dashboard.rows as Array<{ id: string; line_items: unknown[] }>).find((row) => row.id === quote.id)?.line_items.length);
    const longName = "Full detailing and paint refinement + ".repeat(12);
    await query("UPDATE wl.bookings SET service_name=$2 WHERE id=$1",[quote.id,longName]);
    fetchMock.mock.mockImplementation(async (_input,init) => {
      const body = JSON.parse(String(init?.body)) as { description: string; order: { line_items: Array<{ name: string; base_price_money: { amount: number } }> } };
      assert.ok(body.description.length <= 240);
      assert.ok(body.order.line_items[0].name.length <= 240);
      assert.equal(body.order.line_items[0].base_price_money.amount,35400);
      return new Response(JSON.stringify({ payment_link: { id: "test-link", order_id: "test-order", url: "https://square.link/u/test" } }), { headers: { "Content-Type":"application/json" } });
    });
    assert.equal(await createCheckout(quote.id),"https://square.link/u/test");
    assert.equal((await bookingById(quote.id)).service_name,longName,"Gateway shortening does not alter the stored service list");
    t.diagnostic("Approved multi-service checkout charges one correct total with bounded provider labels");
  } finally { await closeDatabase(); }
});
