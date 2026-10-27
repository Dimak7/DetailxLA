const payrollColumns = [
  "Employee",
  "Position",
  "Scheduled hours",
  "Actual hours",
  "Paid hours",
  "Paid hours source",
  "Hourly earnings (USD)",
  "Attributed service revenue (USD)",
  "Job pay (USD)",
  "Tips (USD)",
  "Adjustments (USD)",
  "Total earnings (USD)",
];

function csvCell(value: unknown, text = false) {
  const raw = String(value ?? "");
  // Only text fields need this prefix. Negative monetary amounts remain numbers.
  const safe = text && /^\s*[=+@-]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

const decimal = (value: unknown, divisor: number) => (Number(value ?? 0) / divisor).toFixed(2);

/** Export the saved payroll result; do not recalculate pay from current rates. */
export function payrollCsv(rows: readonly Record<string, unknown>[]) {
  return [
    payrollColumns.map(column => csvCell(column)).join(","),
    ...rows.map(row => {
      const source = row.paid_hours_source === "actual_clocked" ? "Clocked time"
        : row.paid_hours_source === "scheduled_fallback" ? "Scheduled-hours fallback"
          : row.paid_hours_source;
      return [
        csvCell(row.name, true),
        csvCell(row.position, true),
        csvCell(decimal(row.scheduled_minutes, 60)),
        csvCell(decimal(row.actual_minutes, 60)),
        csvCell(decimal(row.minutes, 60)),
        csvCell(source, true),
        csvCell(decimal(row.hourly_earnings_cents, 100)),
        csvCell(decimal(row.attributed_revenue, 100)),
        csvCell(decimal(row.commission_cents, 100)),
        csvCell(decimal(row.tips_cents, 100)),
        csvCell(decimal(row.adjustment_cents, 100)),
        csvCell(decimal(row.total_earnings_cents, 100)),
      ].join(",");
    }),
  ].join("\r\n");
}
