import { createHash, randomUUID } from "node:crypto";
import { AppError } from "./auth";
import { query, transaction, type Query } from "./db";
import type { Session } from "./types";

export type SquareCustomerHistoryRow = {
  square_customer_id: string;
  customer_id?: string | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  creation_source: string;
  first_visit: string | null;
  last_visit: string | null;
  transaction_count: number;
  lifetime_spend_cents: number;
  email_subscription_status: string;
  instant_profile: boolean;
  source_filename?: string;
  imported_at?: string;
  source_fields?: Record<string, string>;
};
export type SquareCustomerHistorySummary = {
  profiles: number;
  named: number;
  anonymous: number;
  transactions: number;
  lifetime_spend_cents: number;
  first_visit: string | null;
  last_visit: string | null;
};

const headers = ["Square Customer ID", "First Name", "Last Name", "Email Address", "Phone Number", "Creation Source", "First Visit", "Last Visit", "Transaction Count", "Lifetime Spend", "Email Subscription Status", "Instant Profile"];
const exportHeaders = ["Reference ID", "First Name", "Last Name", "Email Address", "Phone Number", "Nickname", "Company Name", "Street Address 1", "Street Address 2", "City", "State", "Postal Code", "Birthday", "Memo", "Square Customer ID", "Creation Source", "First Visit", "Last Visit", "Transaction Count", "Lifetime Spend", "Email Subscription Status", "Instant Profile"];
const maximumLength = 1_000_000;

/** Square exports use RFC 4180 quoting, including commas and newlines in cells. */
function csvRows(text: string) {
  if (!text || text.length > maximumLength) throw new AppError("Choose a Square customer CSV smaller than 1 MB.");
  if (text.includes("\0")) throw new AppError("The CSV contains an invalid null character.");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, closed = false;
  const field = () => { row.push(cell); cell = ""; closed = false; };
  const record = () => { field(); if (row.some(value => value !== "")) rows.push(row); row = []; if (rows.length > 5_001) throw new AppError("Import at most 5,000 customer profiles at a time."); };
  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === ",") field();
    else if (char === "\n" || char === "\r") { if (char === "\r" && source[index + 1] === "\n") index++; record(); }
    else if (char === '"' && !cell && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new AppError("The CSV has invalid quoting. Export it again from Square.");
      cell += char;
    }
    if (cell.length > 10_000) throw new AppError("A CSV field is too long.");
  }
  if (quoted) throw new AppError("The CSV has an unfinished quoted field.");
  if (cell || row.length || closed) record();
  return rows;
}

function date(value: string, row: number) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
    throw new AppError(`Row ${row}: visit dates must use YYYY-MM-DD.`);
  return value;
}
function amount(value: string, row: number) {
  const clean = value.replace(/^\$/, "");
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(clean)) throw new AppError(`Row ${row}: lifetime spend must be a nonnegative dollar amount.`);
  const [whole, fraction = ""] = clean.replaceAll(",", "").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new AppError(`Row ${row}: lifetime spend is too large.`);
  return cents;
}
export function parseSquareCustomerHistory(text: string) {
  const table = csvRows(text), columns = table.shift()?.map(value => value.trim()) || [];
  if (new Set(columns).size !== columns.length || columns.some(column => !column || column.length > 200) || headers.some(header => !columns.includes(header)))
    throw new AppError("This is not a Square customer export. Include customer IDs, visits, transaction counts and lifetime spend.");
  if (!table.length) throw new AppError("The CSV does not contain any customer profiles.");
  const ids = new Set<string>();
  const rows: SquareCustomerHistoryRow[] = table.map((values, index) => {
    const line = index + 2;
    if (values.length !== columns.length) throw new AppError(`Row ${line}: the number of fields does not match the header.`);
    const get = (name: string, limit = 500) => {
      const value = values[columns.indexOf(name)].trim();
      if (value.length > limit || value.includes("\0")) throw new AppError(`Row ${line}: ${name} is too long or invalid.`);
      return value;
    };
    const id = get("Square Customer ID", 192);
    if (!/^[A-Za-z0-9_-]+$/.test(id) || ids.has(id)) throw new AppError(`Row ${line}: Square customer IDs must be present and unique.`);
    ids.add(id);
    const count = get("Transaction Count"), transactions = Number(count);
    if (!/^\d+$/.test(count) || !Number.isSafeInteger(transactions) || transactions > 2_147_483_647) throw new AppError(`Row ${line}: transaction count must be a whole number.`);
    const first = date(get("First Visit"), line), last = date(get("Last Visit"), line);
    if (first && last && first > last) throw new AppError(`Row ${line}: first visit is after last visit.`);
    const instant = get("Instant Profile").toLowerCase();
    if (!["yes", "no", "true", "false", ""].includes(instant)) throw new AppError(`Row ${line}: Instant Profile must be Yes or No.`);
    return { square_customer_id: id, first_name: get("First Name", 200), last_name: get("Last Name", 200),
      email: get("Email Address", 320), phone: get("Phone Number", 100).replace(/^'(?=\+?\d)/, ""), creation_source: get("Creation Source", 200),
      first_visit: first, last_visit: last, transaction_count: transactions, lifetime_spend_cents: amount(get("Lifetime Spend"), line),
      email_subscription_status: get("Email Subscription Status", 100), instant_profile: instant === "yes" || instant === "true",
      source_fields: Object.fromEntries(columns.map((column, index) => [column, values[index]])) };
  });
  const summary = summarizeSquareCustomerHistory(rows);
  return { rows, summary, source_hash: createHash("sha256").update(text).digest("hex") };
}
export function summarizeSquareCustomerHistory(rows: SquareCustomerHistoryRow[]): SquareCustomerHistorySummary {
  const first = rows.flatMap(row => row.first_visit ? [row.first_visit] : []).sort();
  const last = rows.flatMap(row => row.last_visit ? [row.last_visit] : []).sort();
  const cents = rows.reduce((total, row) => total + Number(row.lifetime_spend_cents), 0);
  if (!Number.isSafeInteger(cents)) throw new AppError("The combined lifetime spend is too large.");
  return { profiles: rows.length, named: rows.filter(row => row.first_name || row.last_name).length,
    anonymous: rows.filter(row => !row.first_name && !row.last_name && !row.email && !row.phone).length,
    transactions: rows.reduce((total, row) => total + Number(row.transaction_count), 0), lifetime_spend_cents: cents,
    first_visit: first[0] || null, last_visit: last.at(-1) || null };
}

export function requireSquareHistoryAccess(user: Session) {
  if (user.role !== "owner" && user.role !== "admin") throw new AppError("Only an owner or admin can access Square customer history.", 403);
}
function phoneKey(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? `1${digits}` : digits.length >= 8 && digits.length <= 15 ? digits : "";
}
async function matchCustomer(q: Query, row: SquareCustomerHistoryRow): Promise<{ id: string | null; create: boolean }> {
  const email = row.email.trim().toLowerCase(), phone = phoneKey(row.phone);
  if (!email && !phone) return { id: null, create: false };
  const candidates = (await q<{ id: string; email: string; phone: string }>(`SELECT id,email,phone FROM wl.customers
    WHERE ($1<>'' AND lower(trim(email))=$1) OR ($2<>'' AND CASE WHEN length(regexp_replace(phone,'[^0-9]','','g'))=10 THEN '1'||regexp_replace(phone,'[^0-9]','','g') ELSE regexp_replace(phone,'[^0-9]','','g') END=$2)`, [email, phone])).rows;
  if (!candidates.length) return { id: null, create: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) };
  if (candidates.length !== 1) return { id: null, create: false };
  const candidate = candidates[0], existingEmail = candidate.email.trim().toLowerCase(), existingPhone = phoneKey(candidate.phone);
  if ((email && existingEmail && email !== existingEmail) || (phone && existingPhone && phone !== existingPhone)) return { id: null, create: false };
  return { id: candidate.id, create: false };
}
async function customerRecord(q: Query, row: SquareCustomerHistoryRow, user: Session, source: string, recordConsent: boolean) {
  const match = await matchCustomer(q, row);
  let id = match.id, created = false;
  if (match.create) {
    id = (await q<{ id: string }>(`INSERT INTO wl.customers(id,first_name,last_name,email,phone,notes) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(email) DO NOTHING RETURNING id`,
      [randomUUID(), row.first_name, row.last_name, row.email.trim().toLowerCase(), row.phone, row.source_fields?.Memo || ""])).rows[0]?.id || null;
    created = Boolean(id);
    if (!id) id = (await matchCustomer(q, row)).id;
    if (id && created) await q("INSERT INTO wl.timeline(id,customer_id,type,body,actor_id) VALUES($1,$2,'customer_imported',$3,$4)", [randomUUID(), id, `Customer imported from Square (${source}).`, user.user_id]);
  }
  if (!id) return { id: null, created: false };
  await q(`UPDATE wl.customers SET first_name=CASE WHEN first_name='' THEN $2 ELSE first_name END,last_name=CASE WHEN last_name='' THEN $3 ELSE last_name END,phone=CASE WHEN phone='' THEN $4 ELSE phone END WHERE id=$1`, [id, row.first_name, row.last_name, row.phone]);
  const consent = row.email_subscription_status.toLowerCase();
  if (recordConsent && (consent === "unsubscribed" || (consent === "subscribed" && created))) {
    // Unknown never grants consent. A CSV with no opt-in timestamp cannot reverse
    // an existing customer's opt-out; an explicit unsubscribe always takes effect.
    await q("UPDATE wl.customers SET marketing_email=$2,updated_at=now() WHERE id=$1", [id, consent === "subscribed"]);
    await q("INSERT INTO wl.consent_events(id,customer_id,channel,consent,wording,source) VALUES($1,$2,'email',$3,$4,$5)", [randomUUID(), id, consent === "subscribed", `Square export email subscription status: ${consent}`, `Square customer import: ${source}`]);
  }
  return { id, created };
}
export async function importSquareCustomerHistory(text: string, filename: string, user: Session, preview = false) {
  requireSquareHistoryAccess(user);
  const parsed = parseSquareCustomerHistory(text);
  const source = filename.split(/[\\/]/).at(-1)?.trim().slice(0, 200) || "square-customers.csv";
  if (preview) {
    const existing = await query<{ id: string }>("SELECT square_customer_id id FROM wl.square_customer_history WHERE square_customer_id=ANY($1::text[])", [parsed.rows.map(row => row.square_customer_id)]);
    return { summary: parsed.summary, existing: existing.length, added: parsed.rows.length - existing.length, source_hash: parsed.source_hash, preview: true };
  }
  return transaction(async q => {
    // Serialize imports so retries and simultaneous uploads cannot create duplicates.
    await q("LOCK TABLE wl.square_customer_history IN SHARE ROW EXCLUSIVE MODE");
    let added = 0, linked = 0, customers_added = 0;
    for (const row of parsed.rows) {
      const existing = (await q<{ source_hash: string }>("SELECT source_hash FROM wl.square_customer_history WHERE square_customer_id=$1", [row.square_customer_id])).rows[0];
      if (!existing) added++;
      const customer = await customerRecord(q, row, user, source, existing?.source_hash !== parsed.source_hash);
      if (customer.id) linked++;
      if (customer.created) customers_added++;
      await q(`INSERT INTO wl.square_customer_history(square_customer_id,customer_id,first_name,last_name,email,phone,creation_source,first_visit,last_visit,transaction_count,lifetime_spend_cents,email_subscription_status,instant_profile,source_filename,source_hash,imported_by,source_fields)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)
        ON CONFLICT(square_customer_id) DO UPDATE SET customer_id=EXCLUDED.customer_id,first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,email=EXCLUDED.email,phone=EXCLUDED.phone,
        creation_source=EXCLUDED.creation_source,first_visit=EXCLUDED.first_visit,last_visit=EXCLUDED.last_visit,transaction_count=EXCLUDED.transaction_count,lifetime_spend_cents=EXCLUDED.lifetime_spend_cents,
        email_subscription_status=EXCLUDED.email_subscription_status,instant_profile=EXCLUDED.instant_profile,source_filename=EXCLUDED.source_filename,source_hash=EXCLUDED.source_hash,imported_by=EXCLUDED.imported_by,source_fields=EXCLUDED.source_fields,
        imported_at=CASE WHEN wl.square_customer_history.source_hash<>EXCLUDED.source_hash THEN now() ELSE wl.square_customer_history.imported_at END`,
      [row.square_customer_id, customer.id, row.first_name, row.last_name, row.email, row.phone, row.creation_source, row.first_visit, row.last_visit, row.transaction_count, row.lifetime_spend_cents, row.email_subscription_status, row.instant_profile, source, parsed.source_hash, user.user_id, JSON.stringify(row.source_fields)]);
    }
    await q(`INSERT INTO wl.square_customer_imports(source_hash,source_filename,profile_count,summary,imported_by) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(source_hash) DO NOTHING`, [parsed.source_hash, source, parsed.rows.length, JSON.stringify(parsed.summary), user.user_id]);
    return { summary: parsed.summary, existing: parsed.rows.length - added, added, linked, customers_added, source_hash: parsed.source_hash, preview: false };
  });
}
export async function squareCustomerHistory(user: Session, page = 1, search = "") {
  requireSquareHistoryAccess(user);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000) throw new AppError("Choose a valid history page.");
  const summary = (await query<{ profiles: number; named: number; anonymous: number; transactions: string; lifetime_spend_cents: string; first_visit: string | null; last_visit: string | null }>(`SELECT count(*)::int profiles,count(*) FILTER(WHERE first_name<>'' OR last_name<>'')::int named,
    count(*) FILTER(WHERE first_name='' AND last_name='' AND email='' AND phone='')::int anonymous,COALESCE(sum(transaction_count),0)::text transactions,COALESCE(sum(lifetime_spend_cents),0)::text lifetime_spend_cents,
    min(first_visit)::text first_visit,max(last_visit)::text last_visit FROM wl.square_customer_history`))[0];
  const filter = `%${search.trim().slice(0, 200)}%`;
  const matched = (await query<{ count: number }>("SELECT count(*)::int count FROM wl.square_customer_history WHERE first_name||' '||last_name||' '||email||' '||phone||' '||square_customer_id ILIKE $1", [filter]))[0].count;
  const rows = await query<SquareCustomerHistoryRow>(`SELECT h.*,h.first_visit::text,h.last_visit::text,h.lifetime_spend_cents::float8 FROM wl.square_customer_history h WHERE first_name||' '||last_name||' '||email||' '||phone||' '||square_customer_id ILIKE $2 ORDER BY h.last_visit DESC NULLS LAST,h.square_customer_id LIMIT 25 OFFSET $1`, [(page - 1) * 25, filter]);
  return { rows, summary: { ...summary, transactions: Number(summary.transactions), lifetime_spend_cents: Number(summary.lifetime_spend_cents) }, page, pages: Math.max(1, Math.ceil(matched / 25)) };
}
/** Text cells are escaped against spreadsheet formula execution on download. */
export async function exportSquareCustomerHistory(user: Session) {
  requireSquareHistoryAccess(user);
  const rows = await query<SquareCustomerHistoryRow>("SELECT *,first_visit::text,last_visit::text FROM wl.square_customer_history ORDER BY square_customer_id");
  const value = (input: unknown) => { const text = String(input ?? ""); return `"${(/^[\s]*[=+@-]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`; };
  const columns = [...new Set([...exportHeaders, ...rows.flatMap(row => Object.keys(row.source_fields || {}))])];
  return [columns, ...rows.map(row => columns.map(column => row.source_fields?.[column] ?? ""))].map(row => row.map(value).join(",")).join("\r\n");
}
