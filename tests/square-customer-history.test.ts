import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closeDatabase, query } from "../lib/platform/db";
import { exportSquareCustomerHistory, importSquareCustomerHistory, parseSquareCustomerHistory, squareCustomerHistory } from "../lib/platform/square-customer-history";
import { GET, POST } from "../app/api/admin/square-customer-history/route";
import { hash } from "../lib/platform/auth";
import type { Session } from "../lib/platform/types";

process.env.PGLITE_PATH = "memory://square-customer-history";
Object.assign(process.env, { NODE_ENV: "test" });
delete process.env.DATABASE_URL;
delete process.env.RAILWAY_ENVIRONMENT;
const columns = ["Square Customer ID", "First Name", "Last Name", "Email Address", "Phone Number", "Creation Source", "First Visit", "Last Visit", "Transaction Count", "Lifetime Spend", "Email Subscription Status", "Instant Profile", "Memo"];
function csv(profiles: Array<Record<string, string>>) {
  return [columns, ...profiles.map(profile => columns.map(column => profile[column] ?? ({ "Creation Source": "Instant Profile (via Payment)", "First Visit": "2026-06-05", "Last Visit": "2026-10-14", "Transaction Count": "2", "Lifetime Spend": "100.50", "Instant Profile": "Yes" } as Record<string, string>)[column] ?? ""))].map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n");
}
const owner: Session = { id: "test", user_id: randomUUID(), name: "Test owner", email: "history-owner@example.test", role: "owner" };

test("Square CSV parsing preserves source fields, currency cents and anonymous profiles", () => {
  const input = "\uFEFF" + csv([{ "Square Customer ID": "C1", "First Name": "Jo, A", "Phone Number": "'+13125550111", "Memo": 'Line 1\nLine "2"', "Lifetime Spend": "$1,234.56" }, { "Square Customer ID": "C2" }]);
  const parsed = parseSquareCustomerHistory(input);
  assert.equal(parsed.rows[0].first_name, "Jo, A");
  assert.equal(parsed.rows[0].source_fields?.Memo, 'Line 1\nLine "2"');
  assert.equal(parsed.rows[0].phone, "+13125550111");
  assert.equal(parsed.rows[0].source_fields?.["Phone Number"], "'+13125550111");
  assert.deepEqual(parsed.summary, { profiles: 2, named: 1, anonymous: 1, transactions: 4, lifetime_spend_cents: 133506, first_visit: "2026-06-05", last_visit: "2026-10-14" });
  assert.equal(parsed.rows[1].email, "");
});
test("invalid Square CSVs fail before saving any profiles", () => {
  const invalidProfiles: Array<Record<string, string>> = [
    { "Square Customer ID": "" }, { "First Visit": "2026-02-30" }, { "Last Visit": "2020-01-01" }, { "Transaction Count": "1.2" },
    { "Lifetime Spend": "-12" }, { "Lifetime Spend": "1,2.50" }, { "Lifetime Spend": "9007199254740991.99" }, { "Instant Profile": "sometimes" },
  ];
  for (const overrides of invalidProfiles) assert.throws(() => parseSquareCustomerHistory(csv([{ "Square Customer ID": "C1", ...overrides }])));
  assert.throws(() => parseSquareCustomerHistory(csv([{ "Square Customer ID": "C1" }, { "Square Customer ID": "C1" }])), /unique/);
  assert.throws(() => parseSquareCustomerHistory('"Square Customer ID",Name\n"unfinished'), /unfinished/);
  assert.throws(() => parseSquareCustomerHistory("Name,Email\nTest,test@example.test"), /not a Square/);
});
test("history import is private, idempotent, contact-aware and isolated from revenue and messaging", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw Error("Imports must not contact any provider"); });
  try {
    await query("INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,'History owner',$2,'unused','owner')", [owner.user_id, owner.email]);
    const known = randomUUID(), ambiguousOne = randomUUID(), ambiguousTwo = randomUUID();
    await query("INSERT INTO wl.customers(id,first_name,last_name,email,phone,marketing_email) VALUES($1,'Existing','Name','known@example.test','+13125550111',true),($2,'First','Shared','first@example.test','3125550112',false),($3,'Second','Shared','second@example.test','+13125550112',false)", [known, ambiguousOne, ambiguousTwo]);
    const input = csv([
      { "Square Customer ID": "KNOWN", "First Name": "Different", "Email Address": "KNOWN@example.test", "Phone Number": "(312) 555-0111", "Email Subscription Status": "unknown" },
      { "Square Customer ID": "NEW", "First Name": "New", "Email Address": "new@example.test", "Email Subscription Status": "unknown", "Memo": "Customer note" },
      { "Square Customer ID": "PHONE", "First Name": "Phone only", "Phone Number": "3125550144" },
      { "Square Customer ID": "AMBIGUOUS", "Phone Number": "3125550112" },
      { "Square Customer ID": "CONFLICT", "Email Address": "known@example.test", "Phone Number": "3125550199" },
      { "Square Customer ID": "ANONYMOUS" },
      { "Square Customer ID": "SUBSCRIBED", "Email Address": "subscribed@example.test", "Email Subscription Status": "subscribed", "First Name": "=FORMULA()" },
    ]);
    const preview = await importSquareCustomerHistory(input, "history.csv", owner, true);
    assert.equal(preview.added, 7);
    assert.equal((await query("SELECT * FROM wl.square_customer_history")).length, 0);
    assert.equal((await query("SELECT * FROM wl.customers")).length, 3);
    const result = await importSquareCustomerHistory(input, "history.csv", owner);
    assert.equal(result.added, 7);
    assert.ok("customers_added" in result);
    assert.equal(result.customers_added, 2);
    assert.equal(result.linked, 3);
    const saved = await query<{ square_customer_id: string; customer_id: string | null; source_fields: Record<string, string> }>("SELECT * FROM wl.square_customer_history ORDER BY square_customer_id");
    assert.equal(saved.find(row => row.square_customer_id === "KNOWN")?.customer_id, known);
    for (const id of ["PHONE", "AMBIGUOUS", "CONFLICT", "ANONYMOUS"]) assert.equal(saved.find(row => row.square_customer_id === id)?.customer_id, null);
    assert.equal(saved.find(row => row.square_customer_id === "NEW")?.source_fields.Memo, "Customer note");
    const contacts = await query<{ email: string; first_name: string; marketing_email: boolean }>("SELECT email,first_name,marketing_email FROM wl.customers");
    assert.equal(contacts.find(row => row.email === "known@example.test")?.first_name, "Existing", "existing names are not overwritten");
    assert.equal(contacts.find(row => row.email === "known@example.test")?.marketing_email, true, "unknown source does not erase existing consent");
    assert.equal(contacts.find(row => row.email === "new@example.test")?.marketing_email, false, "unknown must not opt in");
    assert.equal(contacts.find(row => row.email === "subscribed@example.test")?.marketing_email, true);
    const firstEvents = (await query("SELECT * FROM wl.consent_events")).length;
    assert.equal((await importSquareCustomerHistory(input, "history.csv", owner)).added, 0);
    assert.equal((await query("SELECT * FROM wl.customers")).length, 5);
    assert.equal((await query("SELECT * FROM wl.consent_events")).length, firstEvents);
    assert.equal((await query("SELECT * FROM wl.square_customer_imports")).length, 1);
    assert.equal((await query("SELECT * FROM wl.bookings")).length, 0);
    assert.equal((await query("SELECT * FROM wl.payments")).length, 0);
    assert.equal((await query("SELECT * FROM wl.square_payments")).length, 0);
    assert.equal((await query("SELECT * FROM wl.messages")).length, 0);
    assert.equal((await query("SELECT * FROM wl.revenue_payments")).length, 0);
    assert.equal((await squareCustomerHistory(owner, 1, "Phone only")).rows.length, 1);
    assert.equal((await squareCustomerHistory(owner)).summary.lifetime_spend_cents, 70350);
    const exported = await exportSquareCustomerHistory(owner);
    assert.match(exported, /"'\=FORMULA\(\)"/);
    assert.match(exported, /"Memo"/);
    assert.equal(parseSquareCustomerHistory(exported).rows.length, 7);
    const unsubscribed = csv([{ "Square Customer ID": "KNOWN", "Email Address": "known@example.test", "Email Subscription Status": "unsubscribed" }]);
    await importSquareCustomerHistory(unsubscribed, "updated.csv", owner);
    assert.equal((await query<{ marketing_email: boolean }>("SELECT marketing_email FROM wl.customers WHERE id=$1", [known]))[0].marketing_email, false);
    await importSquareCustomerHistory(csv([{ "Square Customer ID": "KNOWN", "Email Address": "known@example.test", "Email Subscription Status": "subscribed" }]), "older.csv", owner);
    assert.equal((await query<{ marketing_email: boolean }>("SELECT marketing_email FROM wl.customers WHERE id=$1", [known]))[0].marketing_email, false, "undated subscribed snapshot cannot reverse existing opt-out");
    await assert.rejects(() => squareCustomerHistory({ ...owner, role: "manager" }), /owner or admin/);
    await assert.rejects(() => importSquareCustomerHistory(input, "history.csv", { ...owner, role: "staff" }), /owner or admin/);
    assert.equal((await GET(new Request("https://example.test/api/admin/square-customer-history"))).status, 401);
    assert.equal((await POST(new Request("https://example.test/api/admin/square-customer-history", { method: "POST", headers: { origin: "https://other.example" }, body: "{}" }))).status, 403);
    const token = "a".repeat(64);
    await query("INSERT INTO wl.sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [hash(token), owner.user_id]);
    const response = await GET(new Request("https://example.test/api/admin/square-customer-history", { headers: { cookie: `wl_session=${token}` } }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).summary.profiles, 7);
    const uploadResponse = await POST(new Request("https://example.test/api/admin/square-customer-history", { method: "POST", headers: { cookie: `wl_session=${token}`, origin: "https://example.test", "Content-Type": "application/json" }, body: JSON.stringify({ csv: input, filename: "test.csv" }) }));
    assert.equal(uploadResponse.status, 200);
    assert.equal((await uploadResponse.json()).preview, true, "upload defaults to preview without importing");
    assert.equal((await query("SELECT * FROM wl.square_customer_imports")).length, 3);
    const csvResponse = await GET(new Request("https://example.test/api/admin/square-customer-history?export=csv", { headers: { cookie: `wl_session=${token}` } }));
    assert.equal(csvResponse.status, 200);
    assert.match(csvResponse.headers.get("Content-Disposition") || "", /attachment/);
    assert.equal(csvResponse.headers.get("Cache-Control"), "no-store");
  } finally { await closeDatabase(); }
});
