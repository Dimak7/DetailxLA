"use client";
import { useId, useMemo, useState, type PointerEvent } from "react";
import { financeChartSeries, financeChartValues, financeChartPosition, nearestFinancePoint, type FinanceChartMetric, type FinanceChartMode, type FinanceChartRow } from "@/lib/platform/finance-chart-series";
import chartStyles from "./FinanceChart.module.css";
import { money } from "@/lib/platform/types";
type Bar = { label: string; amount_cents: number };
export function SpendBars({ title, items }: { title: string; items: Bar[] }) {
  const max = Math.max(1, ...items.map((i) => Number(i.amount_cents))),
    total = items.reduce((s, i) => s + Number(i.amount_cents), 0);
  return (
    <section className="paper finance-bars">
      <h2>{title}</h2>
      {items.length ? (
        <>
          <p className="small-note">
            {money(total)} across {items.length}{" "}
            {items.length === 1 ? "group" : "groups"}
          </p>
          {items.slice(0, 12).map((i) => (
            <div className="finance-bar" key={i.label}>
              <div>
                <span>{i.label}</span>
                <strong>{money(Number(i.amount_cents))}</strong>
              </div>
              <div className="finance-bar-track">
                <span
                  style={{ width: `${(Number(i.amount_cents) / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
          {items.length > 12 && (
            <p className="small-note">Largest 12 groups shown.</p>
          )}
        </>
      ) : (
        <p className="small-note">Add expenses to see this breakdown.</p>
      )}
    </section>
  );
}
const chartMetrics: { key: FinanceChartMetric; label: string }[] = [
  { key: "net_operating_profit", label: "Operating result" },
  { key: "revenue", label: "Revenue" },
  { key: "expenses", label: "Expenses" },
];
const compactMoney = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value / 100);
const chartDate = (value: string, monthly = false) => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", ...(!monthly ? { day: "numeric" } : {}), year: "numeric" });

export function ProfitChart({ series }: { series: FinanceChartRow[] }) {
  const [metric, setMetric] = useState<FinanceChartMetric>("net_operating_profit");
  const [mode, setMode] = useState<FinanceChartMode>("running");
  const [active, setActive] = useState<number | null>(null);
  const gradientId = `financial-area-${useId().replace(/:/g, "")}`;
  const { points, granularity } = useMemo(() => financeChartSeries(series), [series]);
  const values = useMemo(() => financeChartValues(points, metric, mode), [points, metric, mode]);
  const totals = useMemo(() => points.reduce((total, point) => ({
    revenue: total.revenue + point.revenue,
    expenses: total.expenses + point.expenses,
    net_operating_profit: total.net_operating_profit + point.net_operating_profit,
  }), { revenue: 0, expenses: 0, net_operating_profit: 0 }), [points]);
  const selected = active === null || !points.length ? null : Math.min(active, points.length - 1);
  const metricLabel = chartMetrics.find(item => item.key === metric)!.label;
  const monthly = granularity === "month", bucketLabel = monthly ? "Monthly" : "Daily";
  const displayed = selected === null ? totals[metric] : values[selected];
  const resultClass = metric === "expenses" ? chartStyles.expenses : metric === "net_operating_profit" && totals[metric] < 0 ? chartStyles.negative : chartStyles.positive;
  const low = Math.min(0, ...values), high = Math.max(0, ...values), span = high - low || 1;
  const width = 1000, left = 8, right = 960, top = 24, bottom = 272;
  const x = (index: number) => left + financeChartPosition(points, index) * (right - left);
  const y = (value: number) => high === low ? (top + bottom) / 2 : top + (high + span * .08 - value) / (span * 1.16) * (bottom - top);
  const line = points.map((_, index) => `${index ? "L" : "M"}${x(index).toFixed(2)},${y(values[index]).toFixed(2)}`).join(" ");
  const area = points.length > 1 ? `${line} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z` : "";
  const first = points[0], last = points[points.length - 1];
  function scrub(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const svgX = (event.clientX - box.left) / box.width * width;
    setActive(nearestFinancePoint(points, (svgX - left) / (right - left)));
  }
  const caption = selected === null ? "Total for selected report period" : `${mode === "running" ? "Running total through" : monthly ? "Recorded in" : "Recorded on"} ${chartDate(points[selected].day, monthly)}`;
  return <section className={`paper ${chartStyles.chart} ${resultClass}`} aria-label="Revenue, costs and operating result">
    <div className={chartStyles.heading}>
      <div><p className="eyebrow">MONEY IN / MONEY OUT</p><h2>Business performance</h2></div>
      <span className={chartStyles.period}>{first ? `${chartDate(first.day, monthly)} – ${chartDate(last.day, monthly)}` : "Selected report period"}</span>
    </div>
    <div className={chartStyles.metrics} role="group" aria-label="Chart metric">
      {chartMetrics.map(item => <button type="button" key={item.key} aria-pressed={metric === item.key} onClick={() => { setMetric(item.key); setActive(null); }}><span>{item.label}</span><strong>{money(totals[item.key])}</strong></button>)}
    </div>
    {points.length ? <>
      <div className={chartStyles.readout}>
        <div><p className={chartStyles.metricLabel}>{metricLabel}</p><strong className={chartStyles.amount}>{money(displayed)}</strong><p className={chartStyles.caption}>{caption}</p></div>
        <div className={chartStyles.modes} role="group" aria-label="Chart calculation"><button type="button" aria-pressed={mode === "running"} onClick={() => { setMode("running"); setActive(null); }}>Running total</button><button type="button" aria-pressed={mode === "daily"} onClick={() => { setMode("daily"); setActive(null); }}>{bucketLabel}</button></div>
      </div>
      <div className={chartStyles.plot}>
        <svg viewBox={`0 0 ${width} 304`} preserveAspectRatio="none" role="slider" tabIndex={0}
          aria-label={`${metricLabel}, ${mode === "running" ? "running total" : bucketLabel.toLowerCase() + " totals"}. Use arrow keys to inspect dates.`}
          aria-valuemin={0} aria-valuemax={Math.max(0, points.length - 1)} aria-valuenow={selected ?? points.length - 1}
          aria-valuetext={`${chartDate(points[selected ?? points.length - 1].day, monthly)}: ${money(values[selected ?? points.length - 1])}`}
          onFocus={() => setActive(current => current ?? points.length - 1)} onBlur={() => setActive(null)}
          onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); scrub(event); }}
          onPointerMove={scrub} onPointerLeave={event => { if (event.pointerType === "mouse") setActive(null); }} onPointerCancel={() => setActive(null)}
          onKeyDown={event => {
            let next = selected ?? points.length - 1;
            if (event.key === "ArrowLeft" || event.key === "ArrowDown") next--;
            else if (event.key === "ArrowRight" || event.key === "ArrowUp") next++;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = points.length - 1;
            else return;
            event.preventDefault(); setActive(Math.max(0, Math.min(points.length - 1, next)));
          }}>
          <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-line)" stopOpacity=".18"/><stop offset="100%" stopColor="var(--chart-line)" stopOpacity=".015"/></linearGradient></defs>
          <line x1={left} x2={right} y1={y(0)} y2={y(0)} className={chartStyles.baseline}/>
          {area && <path d={area} fill={`url(#${gradientId})`}/>}
          <path d={line} fill="none" className={chartStyles.line} vectorEffect="non-scaling-stroke"/>
          {points.length === 1 && <circle cx={x(0)} cy={y(values[0])} r="4" fill="var(--chart-line)"/>}
          {selected !== null && <g><line x1={x(selected)} x2={x(selected)} y1={12} y2={bottom + 5} className={chartStyles.crosshair}/><circle cx={x(selected)} cy={y(values[selected])} r="6" className={chartStyles.cursor}/></g>}
        </svg>
        <div className={`${chartStyles.scale}${high === low ? ` ${chartStyles.flatScale}` : ""}`} aria-hidden="true"><span>{compactMoney(high)}</span>{high !== low && <span>{compactMoney(low)}</span>}</div>
      </div>
      <div className={chartStyles.axis}><span>{chartDate(first.day, monthly)}</span><span>{chartDate(last.day, monthly)}</span></div>
      <p className={chartStyles.hint}>Hover or drag to explore. {mode === "running" ? "Running total starts from zero within this report period." : `${bucketLabel} recorded totals.`}{selected !== null && !points[selected].recorded ? " No recorded activity on this date." : ""}</p>
      <details className={chartStyles.data}><summary>View chart data</summary><div className="table-wrap"><table><caption>{bucketLabel} amounts for the selected report period. The running line adds these amounts over time.</caption><thead><tr><th>Date</th><th>Revenue</th><th>Expenses</th><th>Operating result</th></tr></thead><tbody>{points.map(point => <tr key={point.day}><td>{chartDate(point.day, monthly)}{!point.recorded && <small>No recorded activity</small>}</td><td>{money(point.revenue)}</td><td>{money(point.expenses)}</td><td>{money(point.net_operating_profit)}</td></tr>)}</tbody></table></div></details>
    </> : <div className={chartStyles.empty}><strong>No activity in this period</strong><p>Recorded payments and expenses will appear here. Choose another report period to see earlier activity.</p></div>}
    <p className={chartStyles.note}>Revenue is verified collections less refunds. Operating result is revenue minus recorded expenses; missing expenses can overstate it.</p>
  </section>;
}
export function MarketingCostReturn({
  costs,
  campaigns,
}: {
  costs: Bar[];
  campaigns: Array<{ lead_stream: string; revenue: number; bookings: number }>;
}) {
  const mapping = [
    {
      tag: "business-google",
      name: "Business Google",
      stream: "Business Google · 10%",
    },
    {
      tag: "business-meta",
      name: "Business Meta",
      stream: "Business Meta · 10%",
    },
    { tag: "dima-google", name: "Partner Google", stream: "Dima Google · 25%" },
  ];
  return (
    <section className="paper">
      <p className="eyebrow">RECORDED MARKETING COSTS</p>
      <h2>Which source earns its spend?</h2>
      <p className="small-note">
        Compares expenses you explicitly assign to a marketing source with that
        source’s collected revenue in this period. Imported ad spend is not
        added again. Returns exclude service costs, tax adjustments and
        unrecorded expenses; revenue / spend is ROAS, not net profit.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {[
                "Source",
                "Recorded cost",
                "Collected revenue",
                "Revenue / cost",
                "Revenue less marketing cost",
              ].map((x) => (
                <th key={x}>{x}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mapping.map((m) => {
              const c = costs.find((x) => x.label === m.tag)?.amount_cents || 0,
                revenue = campaigns
                  .filter((x) => x.lead_stream === m.stream)
                  .reduce((s, x) => s + Number(x.revenue), 0);
              return (
                <tr key={m.tag}>
                  <td>{m.name}</td>
                  <td>{c ? money(c) : "Not recorded"}</td>
                  <td>{money(revenue)}</td>
                  <td>{c ? (revenue / c).toFixed(2) + "×" : "—"}</td>
                  <td>{c ? money(revenue - c) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
