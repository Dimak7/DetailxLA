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
export function ProfitChart({
  series,
}: {
  series: Array<{
    day: string;
    revenue: number;
    expenses: number;
    net_operating_profit: number;
  }>;
}) {
  const buckets = new Map<
    string,
    { day: string; revenue: number; expenses: number; profit: number }
  >();
  for (const row of series) {
    const key = series.length > 45 ? row.day.slice(0, 7) : row.day;
    const b = buckets.get(key) || {
      day: key,
      revenue: 0,
      expenses: 0,
      profit: 0,
    };
    b.revenue += Number(row.revenue);
    b.expenses += Number(row.expenses);
    b.profit += Number(row.net_operating_profit);
    buckets.set(key, b);
  }
  const data = [...buckets.values()].sort((a, b) => a.day.localeCompare(b.day)),
    max = Math.max(
      1,
      ...data.flatMap((r) => [r.revenue, r.expenses, Math.abs(r.profit)]),
    ),
    width = 900,
    step = 800 / Math.max(1, data.length),
    y = (v: number) => 160 - (v / max) * 115;
  return (
    <section className="paper finance-chart">
      <p className="eyebrow">MONEY IN / MONEY OUT</p>
      <h2>Revenue, costs &amp; operating result</h2>
      <p className="small-note">
        Verified collections less refunds, compared with recorded expenses.{" "}
        {series.length > 45 ? "Monthly" : "Daily"} totals. Missing expenses can
        overstate profit; this is not a full accounting profit statement.
      </p>
      {data.length ? (
        <>
          <div className="finance-legend">
            <span>● Collected revenue</span>
            <span>● Expenses</span>
            <span>― Operating result</span>
          </div>
          <svg
            viewBox={`0 0 ${width} 330`}
            role="img"
            aria-label="Revenue and expense bars with operating result line. Amounts are available in chart data."
          >
            <line x1="50" x2="855" y1="160" y2="160" stroke="#cad5d4" />
            {[max, 0, -max].map((v) => (
              <text
                key={v}
                x="42"
                y={y(v) + 4}
                textAnchor="end"
                fontSize="10"
                fill="#647571"
              >
                {money(v)}
              </text>
            ))}
            {data.map((r, i) => {
              const x = 50 + i * step;
              return (
                <g key={r.day}>
                  <title>
                    {r.day}: revenue {money(r.revenue)}, expenses{" "}
                    {money(r.expenses)}, result {money(r.profit)}
                  </title>
                  <rect
                    x={x + step * 0.12}
                    y={y(r.revenue)}
                    width={Math.max(1, step * 0.28)}
                    height={160 - y(r.revenue)}
                    rx="2"
                    fill="#1c7668"
                  />
                  <rect
                    x={x + step * 0.44}
                    y={y(r.expenses)}
                    width={Math.max(1, step * 0.28)}
                    height={160 - y(r.expenses)}
                    rx="2"
                    fill="#d1a15e"
                  />
                  {(data.length < 10 ||
                    i % Math.ceil(data.length / 8) === 0) && (
                    <text
                      x={x + step * 0.4}
                      y="307"
                      textAnchor="middle"
                      fill="#647571"
                      fontSize="10"
                    >
                      {r.day.slice(5)}
                    </text>
                  )}
                </g>
              );
            })}
            <polyline
              points={data
                .map((r, i) => `${50 + i * step + step * 0.42},${y(r.profit)}`)
                .join(" ")}
              fill="none"
              stroke="#427aab"
              strokeWidth="3"
            />
            {data.length === 1 && (
              <circle
                cx={50 + step * 0.42}
                cy={y(data[0].profit)}
                r="4"
                fill="#427aab"
              />
            )}
          </svg>
          <details>
            <summary>View chart data</summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Revenue</th>
                    <th>Expenses</th>
                    <th>Operating result</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((r) => (
                    <tr key={r.day}>
                      <td>{r.day}</td>
                      <td>{money(r.revenue)}</td>
                      <td>{money(r.expenses)}</td>
                      <td>{money(r.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p className="small-note">
          Your revenue and expenses will appear here as they are recorded.
        </p>
      )}
    </section>
  );
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
