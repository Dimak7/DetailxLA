import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query, transaction, type Query } from "./db";
import { AppError } from "./auth";
import type { Session } from "./types";

export type ExpenseDirectoryKind = "vendor" | "category";
export type ExpenseDirectoryEntry = { kind: ExpenseDirectoryKind; canonical_key: string; name: string };
export type ExpenseDirectory = { vendors: ExpenseDirectoryEntry[]; categories: ExpenseDirectoryEntry[] };

export function normalizeExpenseChoice(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function expenseChoiceKey(value: string) {
  return normalizeExpenseChoice(value).toLowerCase();
}

const inputSchema = z.object({
  kind: z.enum(["vendor", "category"]),
  name: z.string().transform(normalizeExpenseChoice).pipe(z.string().min(2).max(160)),
}).refine((value) => value.kind !== "category" || value.name.length <= 80, {
  message: "Category names can contain up to 80 characters.", path: ["name"],
});

// Include vendors entered through stock purchases, without requiring a write on read.
const choicesSql = `SELECT DISTINCT ON (kind,canonical_key) kind,canonical_key,name FROM (
 SELECT kind,canonical_key,name,0 priority FROM wl.expense_directory
 UNION ALL
 SELECT 'vendor',lower(regexp_replace(btrim(vendor),'\\s+',' ','g')),
 regexp_replace(btrim(vendor),'\\s+',' ','g'),1 FROM wl.expenses WHERE btrim(vendor)<>''
 UNION ALL
 SELECT 'category',lower(regexp_replace(btrim(category),'\\s+',' ','g')),
 regexp_replace(btrim(category),'\\s+',' ','g'),1 FROM wl.expenses WHERE btrim(category)<>''
) choices ORDER BY kind,canonical_key,priority,name`;

export async function expenseDirectory(): Promise<ExpenseDirectory> {
  const entries = await query<ExpenseDirectoryEntry>(choicesSql);
  return {
    vendors: entries.filter((entry) => entry.kind === "vendor"),
    categories: entries.filter((entry) => entry.kind === "category"),
  };
}

export async function createExpenseDirectoryEntry(raw: unknown, user: Session) {
  if (!["owner", "admin"].includes(user.role)) throw new AppError("Your role cannot manage expense choices.", 403);
  const input = inputSchema.parse(raw), key = expenseChoiceKey(input.name);
  return transaction(async (q) => {
    const existing = (await q<ExpenseDirectoryEntry>(`SELECT * FROM (${choicesSql}) choices WHERE kind=$1 AND canonical_key=$2`, [input.kind, key])).rows[0];
    const name = existing?.name || input.name;
    const inserted = (await q<ExpenseDirectoryEntry>(
      `INSERT INTO wl.expense_directory(kind,canonical_key,name,created_by) VALUES($1,$2,$3,$4)
       ON CONFLICT(kind,canonical_key) DO NOTHING RETURNING kind,canonical_key,name`,
      [input.kind, key, name, user.user_id],
    )).rows[0];
    const entry = inserted || (await q<ExpenseDirectoryEntry>("SELECT kind,canonical_key,name FROM wl.expense_directory WHERE kind=$1 AND canonical_key=$2", [input.kind, key])).rows[0];
    if (inserted) await q(
      "INSERT INTO wl.audit_logs(id,actor_id,entity_type,action,after_data) VALUES($1,$2,'expense_directory','created',$3::jsonb)",
      [randomUUID(), user.user_id, JSON.stringify(entry)],
    );
    return { ...entry, created: Boolean(inserted && !existing) };
  });
}

/** Expense saves may select existing entries, but never invent categories/vendors. */
export async function resolveExpenseDirectory(q: Query, expense: { category: string; vendor: string }) {
  const entries = (await q<ExpenseDirectoryEntry>(choicesSql)).rows;
  const category = entries.find((entry) => entry.kind === "category" && entry.canonical_key === expenseChoiceKey(expense.category));
  if (!category) throw new AppError("Choose a saved category, or use Add category first.");
  const vendorName = normalizeExpenseChoice(expense.vendor);
  const vendor = entries.find((entry) => entry.kind === "vendor" && entry.canonical_key === expenseChoiceKey(vendorName));
  if (vendorName && !vendor) throw new AppError("Choose a saved vendor, or use Add vendor first.");
  return { category: category.name, vendor: vendor?.name || "" };
}
