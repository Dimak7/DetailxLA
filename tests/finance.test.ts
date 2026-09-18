import test from "node:test";
import assert from "node:assert/strict";
import { closeDatabase, query } from "../lib/platform/db";
import { login, sessionFromToken } from "../lib/platform/auth";
import { adminAction } from "../lib/platform/admin";
import { adminData } from "../lib/platform/admin";
import { expenseSummary } from "../lib/platform/finance";

process.env.PGLITE_PATH = "memory://finance";
delete process.env.DATABASE_URL;
process.env.ADMIN_EMAIL = "finance-owner@example.test";
process.env.ADMIN_PASSWORD = "Test-only-long-password-4821";

test("financial and inventory operations", async () => {
  try {
    const owner = await sessionFromToken(await login(process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!, "finance-test"));
    assert.ok(owner);
    const expense = await adminAction("save_expense", { expense_date: "2026-09-01", amount_cents: 300000, category: "Rent", vendor: "Landlord", description: "September rent", payment_method: "ACH", recurrence: "monthly", recurring_start: "2026-09-01", recurring_end: null, receipt_url: "", notes: "" }, owner) as { id: string };
    assert.ok(expense.id);
    const september = await expenseSummary("2026-09-01", "2026-09-30");
    const october = await expenseSummary("2026-10-01", "2026-10-31");
    assert.equal(september.total_cents, 300000);
    assert.equal(october.total_cents, 300000);
    await adminAction("save_expense", { id: expense.id, expense_date: "2026-09-01", amount_cents: 325000, category: "Rent", vendor: "Landlord", description: "Updated rent", payment_method: "ACH", recurrence: "monthly", recurring_start: "2026-09-01", recurring_end: null, receipt_url: "", notes: "" }, owner);
    assert.equal((await expenseSummary("2026-09-01", "2026-09-30")).total_cents, 325000);

    const item = await adminAction("save_inventory_item", { name: "Interior Cleaner", sku: "IC-1", category: "Chemicals", opening_quantity: 5, unit: "gallons", unit_cost_cents: 2500, supplier: "Chemical Supplier", minimum_stock: 3, reorder_quantity: 8, last_purchase_date: "2026-09-01", notes: "", active: true }, owner) as { id: string };
    await adminAction("record_inventory_movement", { item_id: item.id, movement_type: "usage", direction: "out", quantity: 3, occurred_on: "2026-09-02", unit_cost_cents: 2500, supplier: "", notes: "Two jobs", create_expense: false, expense_amount_cents: 0 }, owner);
    let inventory = await query<{ quantity: number; minimum_stock: number; unit_cost_cents: number }>("SELECT quantity,minimum_stock,unit_cost_cents FROM wl.inventory_items WHERE id=$1", [item.id]);
    assert.equal(Number(inventory[0].quantity), 2);
    assert.equal(Number(inventory[0].minimum_stock), 3);
    await adminAction("record_inventory_movement", { item_id: item.id, movement_type: "purchase", direction: "in", quantity: 4, occurred_on: "2026-09-03", unit_cost_cents: 3000, supplier: "Chemical Supplier", notes: "Restock", create_expense: true, expense_amount_cents: 12000 }, owner);
    inventory = await query<{ quantity: number; minimum_stock: number; unit_cost_cents: number }>("SELECT quantity,minimum_stock,unit_cost_cents FROM wl.inventory_items WHERE id=$1", [item.id]);
    assert.equal(Number(inventory[0].quantity), 6);
    assert.equal(Number(inventory[0].unit_cost_cents), 3000);
    assert.equal((await query("SELECT * FROM wl.inventory_movements WHERE item_id=$1", [item.id])).length, 3);
    assert.equal((await query("SELECT * FROM wl.expenses WHERE category='Supplies'")).length, 1);
    assert.ok((await query("SELECT * FROM wl.audit_logs WHERE entity_type IN ('expense','inventory_item','inventory_movement')")).length >= 4);
    const expensesPage = await adminData("expenses", new URLSearchParams({ from: "2026-09-01", to: "2026-09-30" }), owner);
    const inventoryPage = await adminData("inventory", new URLSearchParams({ id: item.id }), owner);
    const reportsPage = await adminData("reports", new URLSearchParams({ from: "2026-09-01", to: "2026-09-30" }), owner);
    assert.ok(Array.isArray(expensesPage.rows));
    assert.equal((inventoryPage.movements as unknown[]).length, 3);
    assert.ok(reportsPage.report);
    await assert.rejects(() => adminAction("save_expense", { expense_date: "2026-09-04", amount_cents: 1, category: "Other", vendor: "", description: "", payment_method: "", recurrence: "one_time", recurring_start: null, recurring_end: null, receipt_url: "", notes: "" }, { ...owner, role: "staff" }), /cannot perform/);
    await adminAction("delete_expense", { id: expense.id }, owner);
    assert.equal((await query("SELECT * FROM wl.expenses WHERE id=$1", [expense.id])).length, 0);
  } finally {
    await closeDatabase();
  }
});
