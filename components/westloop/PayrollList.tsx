"use client";

import type { RecordData as R } from "./AdminControls";
import { PayPlanSummary } from "./EmployeePaySettings";
import { money } from "@/lib/platform/types";
import styles from "./PayrollList.module.css";

type PayrollListProps = {
  records: R[];
  employees: R[];
  rules: R[];
  onHistory: (row: R) => void;
  onPaySettings: (row: R) => void;
};

const text = (value: unknown) => value == null ? "" : String(value);
const number = (value: unknown) => Number(value || 0);
const hours = (value: unknown) => `${(number(value) / 60).toFixed(2)}h`;

export function PayrollList({ records, employees, rules, onHistory, onPaySettings }: PayrollListProps) {
  if (!records.length) return <div className={styles.empty}>
    <h3>No payroll records for this period</h3>
    <p>Choose another date range to review your team’s earnings.</p>
  </div>;

  return <div className={styles.list} aria-label="Employee payroll">
    {records.map(row => {
      const employee = employees.find(item => text(item.id) === text(row.id)) || row;
      const name = text(row.name) || text(employee.name) || "Employee";
      const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("");
      const customRates = rules.filter(rule => text(rule.employee_id) === text(row.id) && rule.active && rule.service_id).length;
      return <article className={styles.employee} key={text(row.id)}>
        <div className={styles.overview}>
          <div className={styles.identity}>
            <span className={styles.avatar} aria-hidden="true">{initials}</span>
            <div><h3>{name}</h3><p>{text(row.position) || text(employee.position) || "Team member"}</p>{customRates > 0 && <span className={styles.rateBadge}>{customRates} custom {customRates === 1 ? "service rate" : "service rates"}</span>}</div>
          </div>
          <dl className={styles.metrics}>
            <div><dt>Job pay</dt><dd>{money(number(row.commission_cents))}</dd></div>
            <div><dt>Tips</dt><dd>{money(number(row.tips_cents))}</dd></div>
            <div><dt>Paid hours</dt><dd>{hours(row.minutes)}</dd></div>
          </dl>
          <div className={styles.total}><span>Total earnings</span><strong>{money(number(row.total_earnings_cents))}</strong></div>
        </div>

        <div className={styles.actions}>
          <button className="button" type="button" onClick={() => onHistory(row)} aria-label={`View work history for ${name}`}>Work history</button>
          <button type="button" onClick={() => onPaySettings(row)} aria-label={`View pay settings for ${name}`}>Pay settings{customRates > 0 && <span className={styles.count} aria-label={`${customRates} custom service rates`}>{customRates}</span>}</button>
        </div>

        <details className={styles.details}>
          <summary><span>Pay breakdown &amp; service rates</span><span className={styles.chevron} aria-hidden="true" /></summary>
          <div className={styles.detailGrid}>
            <section className={styles.detailSection}>
              <h4>Earnings for this period</h4>
              <dl className={styles.breakdown}>
                <div><dt>Hourly pay</dt><dd>{money(number(row.hourly_earnings_cents))}</dd></div>
                <div><dt>Job pay</dt><dd>{money(number(row.commission_cents))}</dd></div>
                <div><dt>Tips</dt><dd>{money(number(row.tips_cents))}</dd></div>
                <div><dt>Adjustments</dt><dd>{money(number(row.adjustment_cents))}</dd></div>
                <div className={styles.totalLine}><dt>Total earnings</dt><dd>{money(number(row.total_earnings_cents))}</dd></div>
              </dl>
              <p className={styles.note}>Attributed service revenue: <strong>{money(number(row.attributed_revenue))}</strong></p>
            </section>
            <section className={styles.detailSection}>
              <h4>Time included</h4>
              <dl className={styles.breakdown}>
                <div><dt>Scheduled</dt><dd>{hours(row.scheduled_minutes)}</dd></div>
                <div><dt>Clocked</dt><dd>{hours(row.actual_minutes)}</dd></div>
                <div className={styles.totalLine}><dt>Paid hours</dt><dd>{hours(row.minutes)}</dd></div>
              </dl>
              <p className={styles.note}>{row.paid_hours_source === "actual_clocked" ? "Uses completed clock entries." : "Uses scheduled hours because there are no completed clock entries in this period."}</p>
            </section>
            <section className={styles.detailSection}>
              <h4>Complete saved pay plan</h4>
              <div className={styles.plan}><PayPlanSummary employee={employee} rules={rules} /></div>
              <p className={styles.note}>Job-specific rates can override this plan. Work history shows the calculation for each completed job.</p>
            </section>
          </div>
        </details>
      </article>;
    })}
  </div>;
}
