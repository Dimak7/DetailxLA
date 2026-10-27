export type FinanceChartMetric = "revenue" | "expenses" | "net_operating_profit";
export type FinanceChartMode = "running" | "daily";
export type FinanceChartRow = {
  day: string;
  revenue: number;
  expenses: number;
  net_operating_profit: number;
};
export type FinanceChartPoint = FinanceChartRow & { timestamp: number; recorded: boolean };

const dayMs = 86_400_000;
const cents = (value: number) => Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;

/** Missing dates in the report's transaction aggregate mean no recorded activity. */
export function financeChartSeries(rows: FinanceChartRow[]) {
  const byDay = new Map<string, FinanceChartPoint>();
  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.day)) continue;
    const timestamp = Date.parse(`${row.day}T00:00:00Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== row.day) continue;
    const previous = byDay.get(row.day) || { day: row.day, timestamp, revenue: 0, expenses: 0, net_operating_profit: 0, recorded: true };
    previous.revenue += cents(row.revenue);
    previous.expenses += cents(row.expenses);
    previous.net_operating_profit += cents(row.net_operating_profit);
    byDay.set(row.day, previous);
  }
  const recorded = [...byDay.values()].sort((a, b) => a.timestamp - b.timestamp);
  if (!recorded.length) return { points: [] as FinanceChartPoint[], granularity: "day" as const };
  const first = recorded[0].timestamp, last = recorded[recorded.length - 1].timestamp;
  // Keep very long reports legible and bounded; every source cent remains included.
  if ((last - first) / dayMs > 730) {
    const months = new Map<string, FinanceChartPoint>();
    for (const row of recorded) {
      const key = row.day.slice(0, 7) + "-01";
      const month = months.get(key) || { day: key, timestamp: Date.parse(`${key}T00:00:00Z`), revenue: 0, expenses: 0, net_operating_profit: 0, recorded: true };
      month.revenue += row.revenue;
      month.expenses += row.expenses;
      month.net_operating_profit += row.net_operating_profit;
      months.set(key, month);
    }
    return { points: [...months.values()], granularity: "month" as const };
  }
  const points: FinanceChartPoint[] = [];
  for (let timestamp = first; timestamp <= last; timestamp += dayMs) {
    const day = new Date(timestamp).toISOString().slice(0, 10);
    points.push(byDay.get(day) || { day, timestamp, revenue: 0, expenses: 0, net_operating_profit: 0, recorded: false });
  }
  return { points, granularity: "day" as const };
}

export function financeChartValues(points: FinanceChartPoint[], metric: FinanceChartMetric, mode: FinanceChartMode) {
  let total = 0;
  return points.map(point => {
    total += point[metric];
    return mode === "running" ? total : point[metric];
  });
}

/** Actual time spacing, including reports that switch to monthly buckets. */
export function financeChartPosition(points: FinanceChartPoint[], index: number) {
  if (points.length <= 1) return 0.5;
  const start = points[0].timestamp, span = points[points.length - 1].timestamp - start;
  return span ? (points[index].timestamp - start) / span : 0.5;
}

export function nearestFinancePoint(points: FinanceChartPoint[], fraction: number) {
  if (points.length <= 1) return 0;
  const target = points[0].timestamp + Math.max(0, Math.min(1, fraction)) * (points[points.length - 1].timestamp - points[0].timestamp);
  let low = 0, high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].timestamp < target) low = middle + 1;
    else high = middle;
  }
  return low > 0 && target - points[low - 1].timestamp <= points[low].timestamp - target ? low - 1 : low;
}
