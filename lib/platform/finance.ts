import { query } from "./db";

export type Expense = {
  id: string;
  expense_date: string;
  amount_cents: number;
  category: string;
  recurrence: "one_time" | "weekly" | "monthly" | "yearly";
  recurring_start: string | null;
  recurring_end: string | null;
};

const day = (value: string) => new Date(value + "T12:00:00Z");
const iso = (value: Date) => value.toISOString().slice(0, 10);
function advance(value: Date, recurrence: Expense["recurrence"]) {
  const next = new Date(value);
  if (recurrence === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  if (recurrence === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
  if (recurrence === "yearly") next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next;
}

export function expenseOccurrences(expense: Expense, start: string, end: string) {
  if (expense.recurrence === "one_time")
    return expense.expense_date >= start && expense.expense_date <= end
      ? [{ date: expense.expense_date, amount_cents: Number(expense.amount_cents), category: expense.category, recurring: false }]
      : [];
  const result: Array<{ date: string; amount_cents: number; category: string; recurring: boolean }> = [];
  let current = day(expense.recurring_start || expense.expense_date);
  const last = expense.recurring_end || end;
  while (iso(current) <= end && iso(current) <= last) {
    if (iso(current) >= start)
      result.push({ date: iso(current), amount_cents: Number(expense.amount_cents), category: expense.category, recurring: true });
    current = advance(current, expense.recurrence);
  }
  return result;
}

export async function expensesForRange(start: string, end: string) {
  const expenses = await query<Expense>(
    "SELECT id,expense_date,amount_cents,category,recurrence,recurring_start,recurring_end FROM wl.expenses WHERE (recurrence='one_time' AND expense_date BETWEEN $1 AND $2) OR (recurrence<>'one_time' AND COALESCE(recurring_start,expense_date)<=$2 AND COALESCE(recurring_end,$2)>=$1)",
    [start, end],
  );
  return expenses.flatMap((expense) => expenseOccurrences(expense, start, end));
}

export async function expenseSummary(start: string, end: string) {
  const occurrences = await expensesForRange(start, end);
  const byCategory = new Map<string, { amount_cents: number; count: number }>();
  const byDay = new Map<string, number>();
  let recurring_cents = 0;
  for (const occurrence of occurrences) {
    const category = byCategory.get(occurrence.category) || { amount_cents: 0, count: 0 };
    category.amount_cents += occurrence.amount_cents;
    category.count++;
    byCategory.set(occurrence.category, category);
    byDay.set(occurrence.date, (byDay.get(occurrence.date) || 0) + occurrence.amount_cents);
    if (occurrence.recurring) recurring_cents += occurrence.amount_cents;
  }
  return {
    total_cents: occurrences.reduce((total, expense) => total + expense.amount_cents, 0),
    recurring_cents,
    one_time_cents: occurrences.reduce((total, expense) => total + (expense.recurring ? 0 : expense.amount_cents), 0),
    byCategory: [...byCategory.entries()].map(([category, value]) => ({ category, ...value })).sort((a, b) => b.amount_cents - a.amount_cents),
    byDay: [...byDay.entries()].map(([day, amount_cents]) => ({ day, amount_cents })).sort((a, b) => a.day.localeCompare(b.day)),
  };
}

export async function inventorySummary() {
  const [summary] = await query<{ items: number; value_cents: number; low_stock: number; out_of_stock: number }>(
    `SELECT count(*)::int items,COALESCE(SUM(quantity*unit_cost_cents),0)::int value_cents,
      count(*) FILTER(WHERE quantity>0 AND quantity<=minimum_stock)::int low_stock,
      count(*) FILTER(WHERE quantity<=0)::int out_of_stock
     FROM wl.inventory_items WHERE active=true`,
  );
  return summary || { items: 0, value_cents: 0, low_stock: 0, out_of_stock: 0 };
}
