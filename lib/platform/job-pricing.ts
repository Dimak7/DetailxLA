import { randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction } from "./db";
import { AppError } from "./auth";
import { prepareJobPriceChange } from "./job-payments";
import type { Row } from "./types";

const cents = z.number().int().min(0).max(10000000);
export const jobPricingSchema = z.object({
  booking_id: z.string().uuid(),
  expected_updated_at: z.string().optional(),
  items: z.array(z.object({
    id: z.string().uuid().optional(), service_id: z.string().uuid().nullable(),
    kind: z.enum(["base_service", "upsell"]), name: z.string().trim().min(2).max(160),
    quantity: z.number().int().min(1).max(100), unit_price_cents: cents.nullable(),
  })).min(1).max(100),
  discounts: z.array(z.object({kind: z.enum(["fixed", "percent"]), value: cents, reason: z.string().trim().min(2).max(500)})).max(20),
  deposit_cents: cents,
});
export async function saveJobPricing(raw: unknown, actorId: string) {
  const input = jobPricingSchema.parse(raw);
  if (!input.items.some(item => item.kind === "base_service")) throw new AppError("Keep at least one service on this job.");
  const ids = input.items.flatMap(item => item.id ? [item.id] : []);
  if (new Set(ids).size !== ids.length) throw new AppError("A service appears more than once. Refresh this job.");
  const gross = input.items.reduce((sum, item) => sum + item.quantity * (item.unit_price_cents || 0), 0);
  if (gross > 100000000) throw new AppError("The job total is too large.");
  const discounts = input.discounts.map(discount => {
    if (discount.kind === "percent" && discount.value > 10000) throw new AppError("Discounts cannot exceed 100%.");
    return {...discount, amount_cents: discount.kind === "percent" ? Math.round(gross * discount.value / 10000) : discount.value};
  });
  const discount = discounts.reduce((sum, item) => sum + item.amount_cents, 0);
  if (discount > gross) throw new AppError("The discount is greater than the service total.");
  const total = input.items.some(item => item.unit_price_cents === null) ? null : gross - discount;
  if (total !== null && input.deposit_cents > total) throw new AppError("The requested deposit cannot exceed the agreed service total.");
  return transaction(async q => {
    const booking = (await q<Row>("SELECT * FROM wl.bookings WHERE id=$1 FOR UPDATE", [input.booking_id])).rows[0];
    if (!booking) throw new AppError("Booking not found.", 404);
    const updatedAt = booking.updated_at instanceof Date ? booking.updated_at.getTime() : new Date(String(booking.updated_at)).getTime();
    if (input.expected_updated_at && updatedAt !== new Date(input.expected_updated_at).getTime()) throw new AppError("This job changed while you were editing. Reload the job before saving.", 409);
    if (["cancelled", "no_show"].includes(String(booking.status))) throw new AppError("Reopen this appointment before changing its price.");
    if (booking.status === "completed" && total === null) throw new AppError("A completed job needs an agreed price for every service.");
    const paidPeriod = (await q(`SELECT pp.id FROM wl.pay_periods pp JOIN wl.payroll_records pr ON pr.pay_period_id=pp.id
      JOIN wl.employees e ON e.id=pr.employee_id WHERE pp.status='paid' AND $2::text BETWEEN pp.start_date AND pp.end_date
      AND (e.user_id=$3 OR EXISTS(SELECT 1 FROM wl.employee_job_assignments a WHERE a.employee_id=e.id AND a.booking_id=$1)) LIMIT 1`, [input.booking_id, booking.booking_date, booking.assigned_to])).rows[0];
    if (paidPeriod) throw new AppError("This job belongs to a paid payroll period. Record an adjustment instead of changing its original price.", 409);
    const previous = (await q<Row>("SELECT * FROM wl.booking_line_items WHERE booking_id=$1 FOR UPDATE", [input.booking_id])).rows;
    if (ids.some(id => !previous.some(item => item.id === id))) throw new AppError("A service does not belong to this job. Reload and try again.");
    const serviceIds = [...new Set(input.items.map(item => item.service_id || String(booking.service_id)))];
    const services = (await q<Row>("SELECT * FROM wl.services WHERE id=ANY($1::uuid[])", [serviceIds])).rows;
    if (services.length !== serviceIds.length) throw new AppError("Choose an existing service.");
    const baseServiceIds = new Set(input.items.filter(item => item.kind === "base_service").map(item => item.service_id || String(booking.service_id)));
    if (input.items.some(item => item.kind === "upsell" && !baseServiceIds.has(item.service_id || String(booking.service_id))))
      throw new AppError("An upgrade still belongs to a removed service. Keep that service or remove its upgrades too.");
    const removed = previous.filter(item => !ids.includes(String(item.id))).map(item => String(item.id));
    const withPayRules = (await q("SELECT id FROM wl.employee_job_assignments WHERE booking_id=$1 AND EXISTS(SELECT 1 FROM jsonb_array_elements(line_pay_rules) r WHERE r->>'line_item_id'=ANY($2::text[]))", [input.booking_id, removed])).rows;
    if (withPayRules.length) throw new AppError("Remove the pay override for this service in Team & pay before removing the service.");
    const oldDiscounts = (await q<Row>("SELECT * FROM wl.booking_discounts WHERE booking_id=$1 ORDER BY created_at,id", [input.booking_id])).rows;
    const comparable = (items: Row[]) => JSON.stringify(items.map(item => ({id:item.id, kind:item.kind, name:item.name, service_id:item.service_id, quantity:Number(item.quantity), unit_price_cents:item.quote_pending || item.unit_price_cents === null ? null : Number(item.unit_price_cents)})).sort((a,b) => String(a.id).localeCompare(String(b.id))));
    const changed = booking.price_cents !== total || Number(booking.deposit_cents) !== input.deposit_cents || comparable(previous) !== comparable(input.items) || JSON.stringify(oldDiscounts.map(d=>({kind:d.kind,value:Number(d.value),reason:d.reason}))) !== JSON.stringify(input.discounts);
    if (changed) await prepareJobPriceChange(q, input.booking_id);
    const items = input.items.map(item => ({...item, id:item.id || randomUUID(), name:item.unit_price_cents === null ? item.name : item.name.replace(/\s*·\s*By quote$/i, "")}));
    for (const item of items) {
      await q(`INSERT INTO wl.booking_line_items(id,booking_id,service_id,kind,name,quantity,unit_price_cents,quote_pending,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET service_id=$3,kind=$4,name=$5,quantity=$6,unit_price_cents=$7,quote_pending=$8`,
        [item.id, input.booking_id, item.service_id, item.kind, item.name, item.quantity, item.unit_price_cents || 0, item.unit_price_cents === null, actorId]);
    }
    if (removed.length) await q("DELETE FROM wl.booking_line_items WHERE booking_id=$1 AND id=ANY($2::uuid[])", [input.booking_id, removed]);
    await q("DELETE FROM wl.booking_discounts WHERE booking_id=$1", [input.booking_id]);
    for (const item of discounts) await q("INSERT INTO wl.booking_discounts(id,booking_id,kind,value,amount_cents,reason,applied_by) VALUES($1,$2,$3,$4,$5,$6,$7)", [randomUUID(), input.booking_id, item.kind, item.value, item.amount_cents, item.reason, actorId]);
    const snapshot = (booking.service_snapshot || {}) as Row;
    const previousServices = Array.isArray(snapshot.selected_services) ? snapshot.selected_services as Row[] : [snapshot];
    const baseItems = items.filter(item => item.kind === "base_service");
    const selectedIds = [...new Set(baseItems.map(item => item.service_id || String(booking.service_id)))];
    const selectedServices = selectedIds.map(id => {
      const old = previousServices.find(service => service.id === id);
      const oldAddons = Array.isArray(old?.selected_addons) ? old.selected_addons as Row[] : [];
      const group = items.filter(item => (item.service_id || String(booking.service_id)) === id);
      const base = group.filter(item => item.kind === "base_service");
      return {
        ...(services.find(service => service.id === id) || {}), ...old, id,
        name: base.map(item => item.name).join(" + "),
        base_cents: base.some(item => item.unit_price_cents === null) ? null : base.reduce((sum,item) => sum + item.quantity * (item.unit_price_cents || 0), 0),
        total_cents: group.some(item => item.unit_price_cents === null) ? null : group.reduce((sum,item) => sum + item.quantity * (item.unit_price_cents || 0), 0),
        selected_addons: group.filter(item => item.kind === "upsell").map(item => ({
          ...(oldAddons.find(addon => addon.line_item_id === item.id) || {id:item.id,description:""}),
          line_item_id: item.id, name:item.name, priceCents:item.unit_price_cents === null ? null : item.quantity * item.unit_price_cents,
        })),
      };
    });
    const updatedSnapshot: Row = {...snapshot, ...selectedServices[0], selected_services:selectedServices, requires_quote:total === null, agreed_total_cents:total};
    await q("UPDATE wl.bookings SET price_cents=$2,deposit_cents=$3,service_snapshot=$4::jsonb,service_id=$5,service_name=$6,updated_at=now() WHERE id=$1", [input.booking_id,total,input.deposit_cents,JSON.stringify(updatedSnapshot),selectedIds[0],baseItems.map(item => item.name).join(" + ")]);
    await q("INSERT INTO wl.audit_logs(id,actor_id,entity_type,entity_id,action,before_data,after_data) VALUES($1,$2,'job_pricing',$3,'saved',$4::jsonb,$5::jsonb)", [randomUUID(),actorId,input.booking_id,JSON.stringify({price_cents:booking.price_cents,items:previous,discounts:oldDiscounts}),JSON.stringify({...input,total_cents:total})]);
    return {ok:true,price_cents:total};
  });
}
