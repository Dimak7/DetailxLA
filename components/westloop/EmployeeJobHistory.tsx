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
      <p className={styles.intro}>Every assigned job, with services, upgrades and this employee’s earnings. Completed jobs count toward earnings; upcoming work is an estimate.</p>
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
        <div className={styles.period}>{filters.start || filters.end ? `${filters.start ? dateLabel(filters.start) : "First job"} – ${filters.end ? dateLabel(filters.end) : "Latest job"}` : "All-time work history"}<span>Completed jobs only in totals</span></div>
        <div className={styles.metrics}>
          <div><span>Completed jobs</span><strong>{data.summary.completed_jobs}</strong></div>
          <div><span>Job earnings</span><strong>{money(data.summary.job_pay_cents)}</strong></div>
          <div><span>Employee tips</span><strong>{money(data.summary.tips_cents)}</strong></div>
          <div><span>Jobs + tips</span><strong>{money(data.summary.total_earnings_cents)}</strong></div>
        </div>
        {data.summary.pending_jobs > 0 && <p className={styles.pending}>{data.summary.pending_jobs} unfinished {data.summary.pending_jobs === 1 ? "job" : "jobs"} · {money(data.summary.pending_job_pay_cents)} estimated job pay, excluded from totals above.</p>}
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
              {!job.earned && <p className={styles.pending}>{inactive ? "Excluded from earned totals." : job.quote_pending ? "Price is not confirmed. Earnings remain an estimate." : "Not completed yet. These earnings are excluded from totals."}</p>}
              {job.earned && job.quote_pending && <p className={styles.pending}>Completed, but the agreed price is missing. Pay is provisional and uses recorded payments, matching Payroll.</p>}
              <details className={styles.breakdown}>
                <summary>Services &amp; earnings breakdown</summary>
                {job.pay_note && <p className={styles.note}>{job.pay_note}</p>}
                <div className={styles.lines}>{job.lines.map(line => <div className={styles.line} key={line.line_item_id}>
                  <div><strong>{line.name}</strong><span>{money(line.net_cents)} after discounts</span></div>
                  <div><span>{line.rate_label}</span><strong>{money(line.pay_cents)} {job.earned ? "job pay" : "estimated pay"}</strong></div>
                </div>)}</div>
              </details>
              <div className={styles.jobFooter}><Link href={`/admin/bookings?id=${encodeURIComponent(job.id)}`}>View booking &amp; photos</Link><span>{job.earned ? "Included in completed-job earnings" : "Not included in completed-job earnings"}</span></div>
            </article>;
          })}
        </div>}
        {data.pagination.total_pages > 1 && <nav className={styles.pagination} aria-label="Work history pages"><button disabled={data.pagination.page <= 1} onClick={() => setFilters({ ...filters, page: data.pagination.page - 1 })}>Previous</button><span>Page {data.pagination.page} of {data.pagination.total_pages} · {data.pagination.total} jobs</span><button disabled={data.pagination.page >= data.pagination.total_pages} onClick={() => setFilters({ ...filters, page: data.pagination.page + 1 })}>Next</button></nav>}
        <p className={styles.note}>Job earnings use the agreed price after discounts, regardless of deposits collected. These are calculated earnings, not proof of payout. Hourly pay and payroll adjustments are shown in <Link href="/admin/payroll">Payroll</Link>.</p>
      </>}
    </div>
  </Modal>;
}
