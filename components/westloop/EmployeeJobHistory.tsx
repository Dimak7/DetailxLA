"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { EmployeeJobHistory as HistoryData } from "@/lib/platform/employee-job-history";
import { money, timeLabel } from "@/lib/platform/types";
import { Modal } from "./AdminControls";
import styles from "./EmployeeJobHistory.module.css";

const statusLabel = (value: string) => value.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function EmployeeJobHistory({ employeeId, employeeName, start = "", end = "", onClose }: {
  employeeId: string;
  employeeName: string;
  start?: string;
  end?: string;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState({ start, end, status: "all" });
  const [filters, setFilters] = useState({ start, end, status: "all", page: 1 });
  const [data, setData] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ employee_id: employeeId, status: filters.status, page: String(filters.page) });
    if (filters.start) query.set("start", filters.start);
    if (filters.end) query.set("end", filters.end);
    void fetch(`/api/admin/employee-job-history?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok || result.ok === false) throw new Error(result.error || "Could not load work history.");
        if (!controller.signal.aborted) setData(result as HistoryData);
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load work history."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [employeeId, filters, retry]);

  return <Modal title={`${employeeName} · Work history`} onClose={onClose} wide>
    <div className={styles.history}>
      <p className={styles.intro}>Job pay and tips for the selected period, with every service and upgrade. See the full total and how much is completed or still an estimate.</p>
      <form className={styles.filters} onSubmit={event => { event.preventDefault(); setFilters({ ...draft, page: 1 }); }}>
        <label>From<input type="date" value={draft.start} max={draft.end || undefined} onChange={event => setDraft({ ...draft, start: event.target.value })} /></label>
        <label>To<input type="date" value={draft.end} min={draft.start || undefined} onChange={event => setDraft({ ...draft, end: event.target.value })} /></label>
        <label>Jobs<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}>
          <option value="all">All assigned jobs</option><option value="completed">Completed</option><option value="in_progress">In progress</option><option value="confirmed">Confirmed</option><option value="new">New</option><option value="cancelled">Cancelled</option><option value="no_show">No-show</option>
        </select></label>
        <button className="button" type="submit" disabled={loading}>Apply</button>
        <button type="button" onClick={() => { const all = { start: "", end: "", status: "all" }; setDraft(all); setFilters({ ...all, page: 1 }); }}>All time</button>
      </form>
      {error && <div className="error-message" role="alert">{error} <button onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
      {loading ? <p role="status" className={styles.empty}>Loading work and earnings…</p> : !error && data && <>
        <div className={styles.period}>{filters.start || filters.end ? `${filters.start ? dateLabel(filters.start) : "First job"} – ${filters.end ? dateLabel(filters.end) : "Latest job"}` : "All-time work history"}<span>Totals cover all matching pages</span></div>
        <div className={styles.metrics}>
          <div><span>Jobs included</span><strong>{data.summary.period_jobs}</strong><small>Cancelled and no-show excluded</small></div>
          <div><span>Job pay{data.summary.pending_jobs > 0 ? " · incl. estimates" : ""}</span><strong>{money(data.summary.period_job_pay_cents)}</strong></div>
          <div><span>Employee tips</span><strong>{money(data.summary.period_tips_cents)}</strong>{data.summary.pending_jobs > 0 && <small>Includes tips on unfinished jobs</small>}</div>
          <div><span>{data.summary.pending_jobs > 0 ? "Estimated total · jobs + tips" : "Total · jobs + tips"}</span><strong>{money(data.summary.period_total_earnings_cents)}</strong></div>
        </div>
        <div className={styles.earningsSplit}>
          <div><span>Completed · {data.summary.completed_jobs} {data.summary.completed_jobs === 1 ? "job" : "jobs"}</span><strong>{money(data.summary.total_earnings_cents)}</strong><small>{money(data.summary.job_pay_cents)} job pay + {money(data.summary.tips_cents)} tips · included in Payroll</small></div>
          <div><span>Awaiting completion · {data.summary.pending_jobs} {data.summary.pending_jobs === 1 ? "job" : "jobs"}</span><strong>{money(data.summary.pending_total_earnings_cents)}</strong><small>{money(data.summary.pending_job_pay_cents)} estimated job pay + {money(data.summary.pending_tips_cents)} tips</small></div>
        </div>
        {data.summary.pending_jobs > 0 && <p className={styles.pending}>Unfinished jobs are included in the estimated total above. If the work is finished, open the booking and set its status to Completed so it counts in Payroll.</p>}
        {!data.jobs.length ? <div className={styles.empty}><h3>No assigned jobs found</h3><p>Try All time or another status. Work appears here when this employee is assigned in Bookings → Open job → Team &amp; pay. Mark finished work Completed to include it in earnings.</p></div> : <div className={styles.jobs}>
          {data.jobs.map(job => {
            const inactive = job.status === "cancelled" || job.status === "no_show";
            return <article key={job.id} className={styles.job}>
              <div className={styles.jobHeading}><div><p className={styles.reference}>{job.reference} · {dateLabel(job.booking_date)} · {timeLabel(job.start_minute)} CT</p><h3>{job.customer_name}</h3><p>{job.vehicle || "Vehicle not recorded"}</p></div><span className="status-pill">{statusLabel(job.status)}</span></div>
              <p className={styles.service}>{job.service_name}</p>
              <div className={styles.jobTotals}>
                <div><span>Service total after discounts</span><strong>{money(job.service_total_cents)}</strong></div>
                <div><span>{job.earned ? "Employee job pay" : "Estimated job pay"}</span><strong>{inactive ? "—" : money(job.job_pay_cents)}</strong></div>
                <div><span>Employee tips</span><strong>{inactive ? "—" : money(job.tips_cents)}</strong></div>
                <div><span>{job.earned ? "Employee earnings" : "Estimated earnings"}</span><strong>{inactive ? "Not earned" : money(job.total_earnings_cents)}</strong></div>
              </div>
              {!job.earned && <p className={styles.pending}>{inactive ? "Excluded from all pay totals." : job.quote_pending ? "Price is not confirmed. Pay is provisional and included in the estimated total." : "Included in the estimated total. Mark this job Completed after the work is finished to include it in Payroll."}</p>}
              {job.earned && job.quote_pending && <p className={styles.pending}>Completed, but the agreed price is missing. Pay is provisional and uses recorded payments, matching Payroll.</p>}
              <details className={styles.breakdown}>
                <summary>Services &amp; earnings breakdown</summary>
                {job.pay_note && <p className={styles.note}>{job.pay_note}</p>}
                <div className={styles.lines}>{job.lines.map(line => <div className={styles.line} key={line.line_item_id}>
                  <div><strong>{line.name}</strong><span>{money(line.net_cents)} after discounts</span></div>
                  <div><span>{line.rate_label}</span><strong>{money(line.pay_cents)} {job.earned ? "job pay" : "estimated pay"}</strong></div>
                </div>)}</div>
              </details>
              <div className={styles.jobFooter}><Link href={`/admin/bookings?id=${encodeURIComponent(job.id)}`}>{job.earned || inactive ? "View booking & photos" : "Review & complete job"}</Link><span>{job.earned ? "Included in Payroll" : inactive ? "Excluded from pay totals" : "Estimated until marked Completed"}</span></div>
            </article>;
          })}
        </div>}
        {data.pagination.total_pages > 1 && <nav className={styles.pagination} aria-label="Work history pages"><button disabled={data.pagination.page <= 1} onClick={() => setFilters({ ...filters, page: data.pagination.page - 1 })}>Previous</button><span>Page {data.pagination.page} of {data.pagination.total_pages} · {data.pagination.total} jobs</span><button disabled={data.pagination.page >= data.pagination.total_pages} onClick={() => setFilters({ ...filters, page: data.pagination.page + 1 })}>Next</button></nav>}
        <p className={styles.note}>Job earnings use the agreed price after discounts, regardless of deposits collected. These are calculated earnings, not proof of payout. Hourly pay and payroll adjustments are shown in <Link href="/admin/payroll">Payroll</Link>.</p>
      </>}
    </div>
  </Modal>;
}
