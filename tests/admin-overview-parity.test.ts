import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createElement, type ComponentType } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";
import { money, timeLabel } from "../lib/platform/types";

// Render the real overview with only its Next navigation, CSS and unrelated
// embedded widgets replaced. No application server or live database is used.
const file = new URL("../components/westloop/AdminOverview.tsx", import.meta.url);
const compiled = transpileModule(readFileSync(file, "utf8"), {
  compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX, esModuleInterop: true },
  fileName: file.pathname,
}).outputText;
const testModule = { exports: {} as { AdminOverview?: ComponentType<Record<string, unknown>> } };
const dependencies: Record<string, unknown> = {
  "react/jsx-runtime": jsxRuntime,
  "next/link": ({ children, ...props }: Record<string, unknown>) => createElement("a", props, children as string),
  "next/navigation": { useRouter: () => ({ push() {} }), useSearchParams: () => new URLSearchParams() },
  "./FinanceCharts": { ProfitChart: () => createElement("div", { "data-testid": "full-financial-chart" }) },
  "./SquareRevenue": { SquareRevenue: () => null },
  "@/lib/platform/types": { money, timeLabel, dateToday: () => "2026-10-27" },
  "./AdminOverview.module.css": { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) },
};
runInNewContext(compiled, {
  module: testModule,
  exports: testModule.exports,
  require(id: string) {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected overview runtime dependency: ${id}`);
    return dependencies[id];
  },
}, { filename: file.pathname });
const AdminOverview = testModule.exports.AdminOverview!;
const report = {
  start: "2026-10-01", end: "2026-10-27", net_sales: 50000, payments_collected: 48000, outstanding: 1000,
  refunds: 1234, tips: 5678, average_order: 9000, revenue_per_customer: 9500, labor_cost: 22200, leads: 6,
  customers: { total: 10, new_customers: 3, returning: 2 },
  bookings: { total: 7, confirmed: 4, completed: 2, cancelled: 1 },
  windows: { today: 10000, week: 20000, month: 30000, year: 40000 },
  series: [{ day: "2026-10-01", revenue: 10000 }, { day: "2026-10-02", revenue: -2000 }],
  square: { net: 48000 },
};
const managerSections = ["dashboard", "bookings", "calendar", "customers", "leads", "employees", "schedule", "payroll", "payments"];
function overview(role: "manager" | "owner", extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(AdminOverview, {
    user: { role, user_id: "viewer", name: "Viewer", email: "viewer@example.test", id: "session" },
    allowedSections: role === "manager" ? managerSections : [...managerSections, "reports", "expenses", "analytics"],
    data: { report, operations: { today_jobs: 0, active_detailers: 2, unassigned_jobs: 0 }, today: [], unassigned: [], ...extra },
  }));
}

test("managers retain operational totals without receiving the owner cost or acquisition reports", () => {
  const html = overview("manager");
  for (const label of ["Business details", "Refunds", "Appointment tips", "Average collected per paid appointment", "Collected per linked customer", "Estimated hourly wages", "New enquiries", "New customers", "Returning customers, all time", "Booking status", "Current collections", "Daily collections"])
    assert.ok(html.includes(label), `Manager can read ${label}`);
  for (const value of ["$12.34", "$56.78", "$90", "$95", "$222", "20.0%", "-$20"])
    assert.ok(html.includes(value), `The supplied operational value ${value} is preserved`);
  assert.doesNotMatch(html, /full-financial-chart|Operating expenses|Operating margin|Ad spend|href="\/admin\/(reports|analytics|marketing)/);
  assert.match(html, /Refunds<\/dt><dd>\$12\.34<\/dd>/);
  assert.match(html, /Cancelled<\/dt><dd>1<\/dd>/);
});

test("owners keep the existing reports entry without a duplicated manager detail panel", () => {
  const html = overview("owner");
  assert.doesNotMatch(html, /Business details/);
  assert.match(html, /href="\/admin\/reports\?from=2026-10-01&amp;to=2026-10-27"/);
});

test("all fetched unassigned jobs remain available, including in-progress jobs after the third row", () => {
  const unassigned = Array.from({ length: 12 }, (_, index) => ({
    id: `job-${index}`, reference: `WLC-${index}`, customer_name: `Unassigned customer ${index}`,
    booking_date: "2026-10-27", start_minute: 600, status: index === 11 ? "in_progress" : "confirmed",
  }));
  const html = overview("manager", { unassigned, operations: { unassigned_jobs: 13 } });
  for (const job of unassigned) assert.ok(html.includes(`/admin/bookings?search=${job.reference}`));
  assert.match(html, /href="\/admin\/bookings">View all bookings/);
  assert.doesNotMatch(html, /view=upcoming|View all upcoming jobs/);
  assert.doesNotMatch(overview("manager", { unassigned, operations: { unassigned_jobs: 12 } }), /View all bookings/);
});
