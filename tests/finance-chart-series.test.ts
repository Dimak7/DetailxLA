import test from "node:test";
import assert from "node:assert/strict";
import { financeChartSeries, financeChartValues, financeChartPosition, nearestFinancePoint, type FinanceChartRow } from "../lib/platform/finance-chart-series";

const row = (day: string, revenue: number, expenses: number): FinanceChartRow => ({ day, revenue, expenses, net_operating_profit: revenue - expenses });

test("financial chart retains exact daily cents, combines duplicates and shows no-activity dates as zero", () => {
  const source = [row("2026-10-03", 10050, 3000), row("2026-10-01", 0, 25000), row("2026-10-03", 5000, 0)];
  const { points, granularity } = financeChartSeries(source);
  assert.equal(granularity, "day");
  assert.deepEqual(points.map(point => point.day), ["2026-10-01", "2026-10-02", "2026-10-03"]);
  assert.equal(points[1].recorded, false);
  assert.equal(points[1].net_operating_profit, 0);
  assert.deepEqual(financeChartValues(points, "net_operating_profit", "running"), [-25000, -25000, -12950]);
  assert.deepEqual(financeChartValues(points, "revenue", "daily"), [0, 0, 15050]);
  assert.deepEqual(financeChartValues(points, "expenses", "running"), [25000, 25000, 28000]);
  assert.equal(source.length, 3, "source rows are never mutated");
});

test("chart preserves refunds and negative financial results", () => {
  const { points } = financeChartSeries([row("2026-10-01", 50000, 10000), row("2026-10-02", -30000, 25000)]);
  assert.deepEqual(financeChartValues(points, "revenue", "running"), [50000, 20000]);
  assert.deepEqual(financeChartValues(points, "net_operating_profit", "daily"), [40000, -55000]);
  assert.deepEqual(financeChartValues(points, "net_operating_profit", "running"), [40000, -15000]);
});

test("empty, one-point, flat and invalid dates have stable chart positions", () => {
  assert.deepEqual(financeChartSeries([]).points, []);
  assert.equal(nearestFinancePoint([], .2), 0);
  const { points } = financeChartSeries([row("2026-02-30", 123, 0), row("2026-10-01", 0, 0)]);
  assert.equal(points.length, 1);
  assert.equal(financeChartPosition(points, 0), .5);
  assert.equal(nearestFinancePoint(points, 2), 0);
  assert.deepEqual(financeChartValues(points, "revenue", "running"), [0]);
});

test("calendar spacing and point selection are date-based, including daylight saving changes", () => {
  const { points } = financeChartSeries([row("2026-10-31", 100, 0), row("2026-11-02", 200, 0)]);
  assert.equal(points.length, 3);
  assert.equal(financeChartPosition(points, 1), .5);
  assert.equal(nearestFinancePoint(points, .51), 1);
  assert.equal(nearestFinancePoint(points, -1), 0);
  assert.equal(nearestFinancePoint(points, 2), 2);
});

test("long reports use monthly totals without losing money or calendar spacing", () => {
  const { points, granularity } = financeChartSeries([row("2023-01-01", 100, 50), row("2023-01-31", 200, 0), row("2026-01-01", 1000, 500)]);
  assert.equal(granularity, "month");
  assert.equal(points.length, 2);
  assert.equal(points[0].revenue, 300);
  assert.deepEqual(financeChartValues(points, "net_operating_profit", "running"), [250, 750]);
  assert.equal(financeChartPosition(points, 1), 1);
});
