import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database, query, closeDatabase } from "../lib/platform/db";
import { expenseDirectorySchema } from "../lib/platform/expense-directory-schema";
import { createExpenseDirectoryEntry, expenseDirectory, expenseChoiceKey, normalizeExpenseChoice, resolveExpenseDirectory } from "../lib/platform/expense-directory";
import type { Session } from "../lib/platform/types";

process.env.PGLITE_PATH = "memory://expense-directory";
Object.assign(process.env, { NODE_ENV: "test" });
delete process.env.DATABASE_URL;
delete process.env.RAILWAY_ENVIRONMENT;

test("expense choice keys normalize casing and whitespace without guessing spellings", () => {
  assert.equal(normalizeExpenseChoice("  Auto\t Care  Supply \n"), "Auto Care Supply");
  assert.equal(expenseChoiceKey("  AUTO Care  Supply "), "auto care supply");
  assert.notEqual(expenseChoiceKey("Auto Care"), expenseChoiceKey("Auto Car"));
});

test("expense directories preserve history and require explicit creation for new choices", async () => {
  try {
    const db = await database();
    const userId = randomUUID();
    const owner: Session = { id: "directory-session", user_id: userId, name: "Directory owner", email: "directory-owner@example.test", role: "owner" };
    await query("INSERT INTO wl.users(id,name,email,password_hash,role) VALUES($1,$2,$3,'unused','owner')", [userId, owner.name, owner.email]);
    const first = randomUUID(), second = randomUUID();
    await query(`INSERT INTO wl.expenses(id,expense_date,amount_cents,category,vendor,created_at)
      VALUES($1,'2026-10-26',2500,'Supplies','Auto Care Supply','2026-10-01'),
      ($2,'2026-10-26',7500,'  supplies  ',' auto   care supply ','2026-10-02')`, [first, second]);
    async function migrate() {
      for (const statement of expenseDirectorySchema.split(";").filter((sql) => sql.trim())) await db.query(statement);
    }
    await migrate();
    await migrate();
    const history = await query<{ category: string; vendor: string; amount_cents: number }>("SELECT category,vendor,amount_cents FROM wl.expenses WHERE id IN ($1,$2) ORDER BY amount_cents", [first, second]);
    assert.deepEqual(history, [
      { category: "Supplies", vendor: "Auto Care Supply", amount_cents: 2500 },
      { category: "Supplies", vendor: "Auto Care Supply", amount_cents: 7500 },
    ]);
    assert.equal((await query<{ count: number }>("SELECT count(*)::int count FROM wl.expense_directory WHERE kind='vendor' AND canonical_key='auto care supply'"))[0].count, 1);
    assert.deepEqual(await resolveExpenseDirectory(db.query, { category: " SUPPLIES ", vendor: " AUTO  CARE SUPPLY " }), { category: "Supplies", vendor: "Auto Care Supply" });
    await assert.rejects(() => resolveExpenseDirectory(db.query, { category: "Supplise", vendor: "Auto Care Supply" }), /Add category first/);
    await assert.rejects(() => resolveExpenseDirectory(db.query, { category: "Supplies", vendor: "Auto Crre Supply" }), /Add vendor first/);
    assert.equal((await expenseDirectory()).vendors.some((entry) => entry.name === "Auto Crre Supply"), false);

    const created = await createExpenseDirectoryEntry({ kind: "category", name: "  Staff   training  " }, owner);
    assert.equal(created.name, "Staff training");
    assert.equal(created.created, true);
    const same = await createExpenseDirectoryEntry({ kind: "category", name: "STAFF TRAINING" }, owner);
    assert.equal(same.created, false);
    assert.equal(same.name, "Staff training");
    const vendor = await createExpenseDirectoryEntry({ kind: "vendor", name: "Shop Equipment" }, owner);
    assert.equal(vendor.created, true);
    assert.deepEqual(await resolveExpenseDirectory(db.query, { category: "Staff training", vendor: vendor.name }), { category: "Staff training", vendor: "Shop Equipment" });
    assert.deepEqual(await resolveExpenseDirectory(db.query, { category: "Other", vendor: "  " }), { category: "Other", vendor: "" });

    await assert.rejects(() => createExpenseDirectoryEntry({ kind: "vendor", name: "Should not exist" }, { ...owner, role: "staff" }), /cannot manage/);
    await assert.rejects(() => createExpenseDirectoryEntry({ kind: "vendor", name: "Should not exist" }, { ...owner, role: "manager" }), /cannot manage/);
    await assert.rejects(() => createExpenseDirectoryEntry({ kind: "category", name: " ".repeat(10) }, owner));
    await assert.rejects(() => createExpenseDirectoryEntry({ kind: "category", name: "x".repeat(81) }, owner));

    // Stock purchases can supply known vendor names after startup; still selectable.
    await query("INSERT INTO wl.expenses(id,expense_date,amount_cents,category,vendor) VALUES($1,'2026-10-26',1000,'Supplies','Inventory supplier')", [randomUUID()]);
    const directory = await expenseDirectory();
    assert.ok(directory.vendors.some((entry) => entry.name === "Inventory supplier"));
    assert.deepEqual(await resolveExpenseDirectory(db.query, { category: "Supplies", vendor: "inventory supplier" }), { category: "Supplies", vendor: "Inventory supplier" });
  } finally { await closeDatabase(); }
});
