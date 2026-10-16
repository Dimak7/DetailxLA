import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "./auth";
import { query, transaction, type Query } from "./db";
import type { Session } from "./types";

type Row = Record<string, unknown>;
const tableOrder = ["attributions", "customers", "vehicles", "leads", "bookings", "payments", "consent_events", "events", "timeline", "messages", "reviews", "customer_tags", "lead_tags", "booking_line_items", "booking_discounts", "employee_job_assignments"] as const;
type Table = typeof tableOrder[number];
type Snapshot = { version: 1; tables: Record<Table, Row[]>; meta_links: Array<{ leadgen_id: string; lead_id: string }> };
const selectionSchema = z.object({
  customers: z.array(z.uuid()).max(100).default([]),
  leads: z.array(z.uuid()).max(100).default([]),
  confirm_test_data: z.literal(true),
}).refine(value => value.customers.length + value.leads.length > 0, "Select at least one confirmed test record.");
function requireOwner(user: Session) {
  if (!["owner", "admin"].includes(user.role)) throw new AppError("Only owners and administrators can archive test data.", 403);
}
// A website payment is disposable test data only when Square's separate canonical
// ledger verifies its exact external ID as sandbox. Keep that ledger untouched.
const verifiedSandboxPayment = `p.provider='square' AND COALESCE(p.metadata->>'square_environment','')='sandbox' AND p.external_id<>''
 AND EXISTS(SELECT 1 FROM wl.square_payments s WHERE s.environment='sandbox' AND s.payment_id=p.external_id)
 AND NOT EXISTS(SELECT 1 FROM wl.square_payments s WHERE s.environment='production' AND s.payment_id=p.external_id)`;
const blockedCustomer = `CASE
 WHEN EXISTS(SELECT 1 FROM wl.payments p WHERE (p.customer_id=c.id OR p.booking_id IN (SELECT id FROM wl.bookings WHERE customer_id=c.id)) AND NOT(${verifiedSandboxPayment})) THEN 'Payment or checkout history'
 WHEN EXISTS(SELECT 1 FROM wl.square_invoices i JOIN wl.bookings b ON b.id=i.booking_id WHERE b.customer_id=c.id) THEN 'Square invoice history'
 WHEN EXISTS(SELECT 1 FROM wl.square_customer_history h WHERE h.customer_id=c.id) THEN 'Imported Square history'
 WHEN EXISTS(SELECT 1 FROM wl.marketing_commission_approvals a JOIN wl.bookings b ON b.id=a.booking_id WHERE b.customer_id=c.id) THEN 'Marketing commission history'
 WHEN EXISTS(SELECT 1 FROM wl.bookings b JOIN wl.pay_periods pp ON b.booking_date BETWEEN pp.start_date AND pp.end_date
   JOIN wl.payroll_records pr ON pr.pay_period_id=pp.id JOIN wl.employees e ON e.id=pr.employee_id
   WHERE b.customer_id=c.id AND pp.status='paid' AND (e.user_id=b.assigned_to OR EXISTS(SELECT 1 FROM wl.employee_job_assignments ja WHERE ja.booking_id=b.id AND ja.employee_id=e.id))) THEN 'Paid payroll history'
 ELSE '' END`;
export async function testDataCleanupPreview(user: Session) {
  requireOwner(user);
  const [customers, leads, archives] = await Promise.all([
    query(`SELECT c.id,c.first_name||' '||c.last_name name,c.email,c.phone,c.created_at,
      (SELECT count(*)::int FROM wl.bookings b WHERE b.customer_id=c.id) bookings,
      (SELECT count(*)::int FROM wl.leads l WHERE l.customer_id=c.id) leads,
      ${blockedCustomer} blocked_reason FROM wl.customers c ORDER BY c.created_at DESC LIMIT 500`),
    query(`SELECT l.id,l.name,l.email,l.phone,l.created_at,l.origin,
      CASE WHEN EXISTS(SELECT 1 FROM wl.bookings b WHERE b.lead_id=l.id) THEN 'Linked booking — archive the customer instead' ELSE '' END blocked_reason
      FROM wl.leads l WHERE l.customer_id IS NULL ORDER BY l.created_at DESC LIMIT 500`),
    query("SELECT id,label,created_at,restored_at,jsonb_array_length(snapshot->'tables'->'customers') customer_count,jsonb_array_length(snapshot->'tables'->'leads') lead_count,jsonb_array_length(snapshot->'tables'->'bookings') booking_count FROM wl.test_data_archives ORDER BY created_at DESC LIMIT 100"),
  ]);
  return { customers, leads, archives };
}

async function capture(q: Query, customers: string[], selectedLeads: string[]) {
  const tables = Object.fromEntries(tableOrder.map(table => [table, []])) as unknown as Record<Table, Row[]>;
  tables.customers = (await q("SELECT * FROM wl.customers WHERE id=ANY($1::uuid[]) FOR UPDATE", [customers])).rows;
  if (tables.customers.length !== customers.length) throw new AppError("A selected customer has changed or was already archived. Refresh the preview.", 409);
  const blocked = (await q<{ name: string; reason: string }>(`SELECT c.first_name||' '||c.last_name name,${blockedCustomer} reason FROM wl.customers c WHERE c.id=ANY($1::uuid[])`, [customers])).rows.find(row => row.reason);
  if (blocked) throw new AppError(`${blocked.name} is protected: ${blocked.reason}. Financial and external records must remain available.`, 409);
  tables.vehicles = (await q("SELECT * FROM wl.vehicles WHERE customer_id=ANY($1::uuid[]) FOR UPDATE", [customers])).rows;
  tables.bookings = (await q("SELECT * FROM wl.bookings WHERE customer_id=ANY($1::uuid[]) FOR UPDATE", [customers])).rows;
  const bookingIds = tables.bookings.map(row => String(row.id));
  tables.leads = (await q("SELECT * FROM wl.leads WHERE customer_id=ANY($1::uuid[]) OR id=ANY($2::uuid[]) OR id IN (SELECT lead_id FROM wl.bookings WHERE id=ANY($3::uuid[])) FOR UPDATE", [customers, selectedLeads, bookingIds])).rows;
  const leadIds = tables.leads.map(row => String(row.id));
  if (selectedLeads.some(id => !leadIds.includes(id))) throw new AppError("A selected lead has changed or was already archived. Refresh the preview.", 409);
  if (tables.leads.some(row => row.customer_id && !customers.includes(String(row.customer_id)))) throw new AppError("A selected lead belongs to another customer. Archive that customer's test record instead.", 409);
  if ((await q("SELECT id FROM wl.bookings WHERE (lead_id=ANY($1::uuid[]) OR vehicle_id=ANY($3::uuid[])) AND NOT(id=ANY($2::uuid[])) LIMIT 1", [leadIds, bookingIds, tables.vehicles.map(row => row.id)])).rows.length)
    throw new AppError("A selected record is shared with another customer's booking. Archive was cancelled.", 409);
  const attributionIds = [...new Set([...tables.customers, ...tables.leads, ...tables.bookings].map(row => row.attribution_id).filter(Boolean))];
  tables.attributions = (await q(`SELECT a.* FROM wl.attributions a WHERE id=ANY($1::uuid[])
    AND NOT EXISTS(SELECT 1 FROM wl.customers c WHERE c.attribution_id=a.id AND NOT(c.id=ANY($2::uuid[])))
    AND NOT EXISTS(SELECT 1 FROM wl.leads l WHERE l.attribution_id=a.id AND NOT(l.id=ANY($3::uuid[])))
    AND NOT EXISTS(SELECT 1 FROM wl.bookings b WHERE b.attribution_id=a.id AND NOT(b.id=ANY($4::uuid[]))) FOR UPDATE`, [attributionIds, customers, leadIds, bookingIds])).rows;
  const exclusiveAttributions = tables.attributions.map(row => row.id);
  const metaLinks = (await q<{ leadgen_id: string; lead_id: string }>("SELECT leadgen_id,lead_id FROM wl.meta_lead_events WHERE lead_id=ANY($1::uuid[]) FOR UPDATE", [leadIds])).rows;
  const where: Record<Exclude<Table, "attributions" | "customers" | "vehicles" | "leads" | "bookings">, { sql: string; args: unknown[] }> = {
    payments: { sql: "customer_id=ANY($1::uuid[]) OR booking_id=ANY($2::uuid[])", args: [customers, bookingIds] },
    consent_events: { sql: "customer_id=ANY($1::uuid[])", args: [customers] },
    events: { sql: "customer_id=ANY($1::uuid[]) OR booking_id=ANY($2::uuid[]) OR attribution_id=ANY($3::uuid[])", args: [customers, bookingIds, exclusiveAttributions] },
    timeline: { sql: "customer_id=ANY($1::uuid[]) OR booking_id=ANY($2::uuid[]) OR lead_id=ANY($3::uuid[])", args: [customers, bookingIds, leadIds] },
    messages: { sql: "customer_id=ANY($1::uuid[]) OR booking_id=ANY($2::uuid[]) OR dedupe_key=ANY($3::text[])", args: [customers, bookingIds, metaLinks.map(event => `meta-lead:${event.leadgen_id}:telegram`)] },
    reviews: { sql: "customer_id=ANY($1::uuid[]) OR booking_id=ANY($2::uuid[])", args: [customers, bookingIds] },
    customer_tags: { sql: "customer_id=ANY($1::uuid[])", args: [customers] },
    lead_tags: { sql: "lead_id=ANY($1::uuid[])", args: [leadIds] },
    booking_line_items: { sql: "booking_id=ANY($1::uuid[])", args: [bookingIds] },
    booking_discounts: { sql: "booking_id=ANY($1::uuid[])", args: [bookingIds] },
    employee_job_assignments: { sql: "booking_id=ANY($1::uuid[])", args: [bookingIds] },
  };
  for (const [table, filter] of Object.entries(where))
    tables[table as Table] = (await q(`SELECT * FROM wl.${table} WHERE ${filter.sql} FOR UPDATE`, filter.args)).rows;
  if (tables.payments.length && (await q(`SELECT p.id FROM wl.payments p WHERE p.id=ANY($1::uuid[]) AND NOT(${verifiedSandboxPayment}) LIMIT 1`, [tables.payments.map(row => row.id)])).rows.length)
    throw new AppError("Payment verification changed during review. Nothing was archived; refresh the preview.", 409);
  for (const rows of Object.values(tables))
    for (const row of rows) {
      if (row.customer_id && !customers.includes(String(row.customer_id)) || row.booking_id && !bookingIds.includes(String(row.booking_id)) || row.lead_id && !leadIds.includes(String(row.lead_id)))
        throw new AppError("A selected test record has history shared with an unselected record. Archive was cancelled.", 409);
    }
  if (tables.messages.some(row => row.status === "sending")) throw new AppError("A message for this record is currently being delivered. Try again when delivery finishes.", 409);
  return { version: 1, tables, meta_links: metaLinks } satisfies Snapshot;
}

export async function archiveTestData(input: unknown, user: Session) {
  requireOwner(user);
  const selection = selectionSchema.parse(input);
  return transaction(async q => {
    await q("SELECT id FROM wl.schedule_guard WHERE id=1 FOR UPDATE");
    const snapshot = await capture(q, [...new Set(selection.customers)], [...new Set(selection.leads)]);
    const id = randomUUID();
    const label = [...snapshot.tables.customers.map(row => `${row.first_name} ${row.last_name}`), ...snapshot.tables.leads.filter(row => !row.customer_id).map(row => row.name)].join(", ").slice(0, 1000);
    await q("INSERT INTO wl.test_data_archives(id,label,snapshot,created_by) VALUES($1,$2,$3::jsonb,$4)", [id, label, JSON.stringify(snapshot), user.user_id]);
    // Keep the external event as a processed tombstone: repeated webhooks must not recreate test leads.
    await q("UPDATE wl.meta_lead_events SET lead_id=NULL,imported_at=COALESCE(imported_at,now()),locked_at=NULL WHERE lead_id=ANY($1::uuid[])", [snapshot.tables.leads.map(row => row.id)]);
    for (const table of [...tableOrder].reverse()) {
      const rows = snapshot.tables[table];
      if (!rows.length) continue;
      if (table === "customer_tags") await q("DELETE FROM wl.customer_tags WHERE customer_id=ANY($1::uuid[])", [selection.customers]);
      else if (table === "lead_tags") await q("DELETE FROM wl.lead_tags WHERE lead_id=ANY($1::uuid[])", [snapshot.tables.leads.map(row => row.id)]);
      else await q(`DELETE FROM wl.${table} WHERE id=ANY($1::${table === "events" ? "text" : "uuid"}[])`, [rows.map(row => row.id)]);
    }
    await q("INSERT INTO wl.audit_logs(id,actor_id,entity_type,entity_id,action,after_data) VALUES($1,$2,'test_data_archive',$3,'archived',$4::jsonb)", [randomUUID(), user.user_id, id, JSON.stringify({ customers: snapshot.tables.customers.length, leads: snapshot.tables.leads.length, bookings: snapshot.tables.bookings.length })]);
    return { id };
  });
}

export async function restoreTestData(input: unknown, user: Session) {
  requireOwner(user);
  const { id } = z.object({ id: z.uuid() }).parse(input);
  return transaction(async q => {
    await q("SELECT id FROM wl.schedule_guard WHERE id=1 FOR UPDATE");
    const archive = (await q<{ snapshot: Snapshot; restored_at: string | null }>("SELECT snapshot,restored_at FROM wl.test_data_archives WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!archive) throw new AppError("Archive not found.", 404);
    if (archive.restored_at) return { id, restored: true };
    if (archive.snapshot.version !== 1) throw new AppError("This archive needs a compatible restore version.", 409);
    for (const table of tableOrder) {
      let rows = archive.snapshot.tables[table] || [];
      if (!rows.length) continue;
      // Restoring records must never resend old test emails, SMS or conversion notifications.
      if (table === "messages") rows = rows.map(row => ["queued", "sending", "failed", "skipped"].includes(String(row.status)) ? { ...row, status: "cancelled", locked_at: null, error: "Restored test archive: delivery intentionally disabled" } : row);
      const columns = Object.keys(rows[0]);
      if (columns.some(column => !/^[a-z_][a-z0-9_]*$/.test(column))) throw new AppError("Invalid archive columns.", 409);
      const names = columns.map(column => `"${column}"`).join(",");
      await q(`INSERT INTO wl.${table} (${names}) SELECT ${names} FROM jsonb_populate_recordset(NULL::wl.${table},$1::jsonb)`, [JSON.stringify(rows)]);
    }
    for (const link of archive.snapshot.meta_links) {
      const restored = await q("UPDATE wl.meta_lead_events SET lead_id=$2 WHERE leadgen_id=$1 AND lead_id IS NULL RETURNING leadgen_id", [link.leadgen_id, link.lead_id]);
      if (!restored.rows.length) throw new AppError("The external lead link changed. Nothing was restored; review the archive before retrying.", 409);
    }
    await q("UPDATE wl.test_data_archives SET restored_at=now(),restored_by=$2 WHERE id=$1", [id, user.user_id]);
    await q("INSERT INTO wl.audit_logs(id,actor_id,entity_type,entity_id,action) VALUES($1,$2,'test_data_archive',$3,'restored')", [randomUUID(), user.user_id, id]);
    return { id, restored: true };
  });
}
