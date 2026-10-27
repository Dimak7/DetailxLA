"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { RecordData } from "./AdminControls";
import { ProfitChart } from "./FinanceCharts";
import { SquareRevenue } from "./SquareRevenue";
import type { report } from "@/lib/platform/reporting";
import type { squareRevenueStatus } from "@/lib/integrations/square-reporting";
import { dateToday, money, timeLabel, type Session } from "@/lib/platform/types";
import styles from "./AdminOverview.module.css";

type Report = Awaited<ReturnType<typeof report>>;
const records = (value: unknown) => Array.isArray(value) ? value as RecordData[] : [];
const text = (value: unknown) => value == null ? "" : String(value);
const number = (value: unknown) => Number(value || 0);
const shortDate = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const jobHref = (job: RecordData) => `/admin/bookings?search=${encodeURIComponent(text(job.reference) || text(job.customer_name))}`;
const statusLabels: Record<string, string> = { new: "New", confirmed: "Booked", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled", no_show: "No-show" };
function AttentionIcon({ complete = false }: { complete?: boolean }) {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="7.5" />{complete ? <path d="m6.5 10 2.3 2.3 4.7-5" /> : <path d="M10 5.8v5.1m0 2.7v.2" strokeLinecap="round" />}</svg>;
}

type OperationalReport = Pick<Report, "refunds" | "tips" | "average_order" | "revenue_per_customer" | "labor_cost" | "leads" | "customers" | "bookings" | "windows" | "series">;
function OperationalDetails({ report: rep, period, today }: { report: OperationalReport; period: string; today: string }) {
  const customerCount = number(rep.customers.total);
  const groups = [
    { title: "Payments & earnings", note: period, rows: [
      { label: "Refunds", value: money(rep.refunds) },
      { label: "Appointment tips", value: money(rep.tips) },
      { label: "Average collected per paid appointment", value: money(rep.average_order) },
      { label: "Collected per linked customer", value: money(rep.revenue_per_customer) },
      { label: "Estimated hourly wages", value: money(rep.labor_cost) },
    ] },
    { title: "Customers & enquiries", note: "New customers and enquiries use the selected period.", rows: [
      { label: "New enquiries", value: String(rep.leads) },
      { label: "New customers", value: String(number(rep.customers.new_customers)) },
      { label: "Customers, all time", value: String(customerCount) },
      { label: "Returning customers, all time", value: String(number(rep.customers.returning)) },
      { label: "Repeat customer share", value: customerCount ? `${(number(rep.customers.returning) / customerCount * 100).toFixed(1)}%` : "No customers" },
    ] },
    { title: "Booking status", note: "Bookings created in this period, shown by their current status.", rows: Object.entries(rep.bookings).map(([status, count]) => ({ label: status === "total" ? "All bookings" : statusLabels[status] || status.replaceAll("_", " "), value: String(count) })) },
    { title: "Current collections", note: `Through ${shortDate(today)} · Chicago time`, rows: [["today", "Today"], ["week", "This week"], ["month", "This month"], ["year", "This year"]].map(([key, label]) => ({ label, value: money(number(rep.windows[key])) })) },
  ];
  const maxCollection = Math.max(1, ...rep.series.map(row => Math.abs(number(row.revenue))));
  return <details className={styles.disclosure}>
    <summary><strong>Business details</strong><span>Payments, customers & visits</span></summary>
    <div className={styles.operationalDetails}>
      <div className={styles.operationalGrid}>{groups.map(group => <section key={group.title}>
        <h3>{group.title}</h3><p>{group.note}</p>
        <dl>{group.rows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
      </section>)}</div>
      <p className={styles.operationalNote}>Appointment tips belong to completed website jobs. Collection averages use linked payments. Hourly wages exclude job commissions and tips; see Employee pay for full earnings.</p>
      <details className={styles.dailyCollections}><summary>Daily collections · {period}</summary>
        <p>Verified payments less refunds, by payment date. Days without recorded payments are omitted.</p>
        {rep.series.length ? <dl>{rep.series.map(row => <div key={text(row.day)}>
          <dt>{shortDate(text(row.day))}</dt><dd><strong>{money(number(row.revenue))}</strong><span aria-hidden="true" className={number(row.revenue) < 0 ? styles.refundBar : undefined} style={{ width: `${Math.abs(number(row.revenue)) / maxCollection * 100}%` }} /></dd>
        </div>)}</dl> : <p>No verified payments in this period.</p>}
      </details>
    </div>
  </details>;
}

export function AdminOverview({ data, user, allowedSections }: { data: RecordData; user: Session; allowedSections: string[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const rep = data.report as Report | undefined;
  if (!rep) return null;
  const canBook = allowedSections.includes("bookings") && user.role !== "staff";
  const canSeeCosts = allowedSections.includes("expenses"), canSeeReports = allowedSections.includes("reports"), canSeePayments = allowedSections.includes("payments");
  const operations = data.operations as RecordData | undefined, today = dateToday();
  const agenda = records(data.today).filter(job => !["cancelled", "no_show"].includes(text(job.status)));
  const cancelledCount = records(data.today).length - agenda.length;
  const unassigned = records(data.unassigned), unassignedCount = number(operations?.unassigned_jobs);
  const inventory = data.inventory as RecordData | undefined;
  const stockAlerts = allowedSections.includes("inventory") ? number(inventory?.low_stock) + number(inventory?.out_of_stock) : 0;
  const period = `${shortDate(rep.start)} – ${shortDate(rep.end)}`;
  const dateLabel = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  const hasCustomDates = Boolean(params.get("from") || params.get("to")), range = params.get("range") || "30";
  const kpis = [
    { label: "Bookings today", value: String(number(operations?.today_jobs)), title: "Appointments today, excluding cancellations and no-shows", href: allowedSections.includes("calendar") ? `/admin/calendar?date=${today}` : undefined },
    { label: "Active jobs", value: String(agenda.filter(job => text(job.status) === "in_progress").length), title: "Today’s jobs currently in progress", href: canBook ? `/admin/bookings?date=${today}&status=in_progress` : undefined },
    { label: "Active detailers", value: String(number(operations?.active_detailers)), title: "Active team members with a Detailer profile", href: allowedSections.includes("employees") ? "/admin/employees" : undefined },
    ...(canSeePayments ? [{ label: "Collected today", value: money(number(rep.windows.today)), title: "Payments received today, less refunds; includes deposits and tips", href: "/admin/payments" }] : []),
  ];
  function changePeriod(value: string) {
    const next = new URLSearchParams(params.toString());
    next.set("range", value); next.delete("from"); next.delete("to");
    router.push(`/admin/dashboard?${next}`, { scroll: false });
  }
  function agendaRows(jobs: RecordData[]) {
    return jobs.map(job => {
      const vehicle = text(job.vehicle_label) || [job.vehicle_year, job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ");
      return <div className={styles.appointment} key={text(job.id)}>
        <time className={styles.appointmentTime}>{timeLabel(number(job.start_minute))}</time>
        <div className={styles.appointmentPerson}><strong>{text(job.customer_name)}</strong><span>{vehicle || text(job.reference)}</span></div>
        <div className={styles.appointmentService}><strong>{text(job.service_name)}</strong><span>{statusLabels[text(job.status)] || text(job.status)}{job.detailer_name ? ` · ${text(job.detailer_name)}` : ""}</span></div>
        {canBook && <Link className={styles.actionPill} href={jobHref(job)} aria-label={`Open job for ${text(job.customer_name)}`}>Open job</Link>}
      </div>;
    });
  }
  return <div className={styles.overview}>
    <header className={styles.header}><h1>Today at the studio</h1><p>{dateLabel}</p></header>
    <div className={`${styles.snapshot} ${!canBook ? styles.snapshotWithoutAction : ""}`}>
      {canBook && <Link className={styles.newBooking} href="/admin/bookings?new=booking">New booking</Link>}
      <div className={styles.kpis} aria-label="Today’s studio overview">{kpis.map(kpi => {
        const content = <><span>{kpi.label}</span><strong>{kpi.value}</strong></>;
        return kpi.href ? <Link className={styles.kpi} key={kpi.label} href={kpi.href} title={kpi.title}>{content}</Link> : <div className={styles.kpi} key={kpi.label} title={kpi.title}>{content}</div>;
      })}</div>
    </div>
    <div className={styles.daySurface}>
      <section className={styles.agenda} aria-labelledby="overview-agenda-title">
        <div className={styles.sectionHeading}><h2 id="overview-agenda-title">Main agenda</h2>{allowedSections.includes("calendar") && <Link className={styles.quietLink} href={`/admin/calendar?date=${today}`}>Calendar</Link>}</div>
        {agenda.length ? <div className={styles.appointments}>{agendaRows(agenda.slice(0, 4))}{agenda.length > 4 && <details className={styles.moreAppointments}><summary>Show {agenda.length - 4} more {agenda.length === 5 ? "appointment" : "appointments"}</summary>{agendaRows(agenda.slice(4))}</details>}</div> : <div className={styles.emptyAgenda}><strong>A little room in the day.</strong><p>No appointments scheduled for today.</p>{canBook && <Link className={styles.actionPill} href="/admin/bookings?new=booking">Add a booking</Link>}</div>}
        <div className={styles.agendaFooter}><span>Chicago time{cancelledCount > 0 ? ` · ${cancelledCount} cancelled / no-show hidden` : ""}</span>{canBook && <Link className={styles.quietLink} href="/admin/bookings">All bookings</Link>}</div>
      </section>
      <aside className={styles.attention} id="overview-attention" aria-labelledby="overview-attention-title">
        <h2 id="overview-attention-title">Needs attention</h2><div className={styles.attentionList}>
          {unassignedCount > 0 && canBook && <details className={styles.assignmentDetails}><summary><AttentionIcon /><span>{unassignedCount} {unassignedCount === 1 ? "job needs" : "jobs need"} a detailer</span></summary><div>{unassigned.map(job => <Link key={text(job.id)} href={jobHref(job)} className={styles.unassignedJob}><strong>{text(job.customer_name)}</strong><span>{text(job.booking_date) === today ? "Today" : shortDate(text(job.booking_date))} · {timeLabel(number(job.start_minute))}</span></Link>)}{unassignedCount > unassigned.length && <Link className={styles.quietLink} href="/admin/bookings">View all bookings</Link>}</div></details>}
          {rep.outstanding > 0 && canBook && canSeePayments && <Link href="/admin/bookings?status=completed" className={styles.attentionAction}><AttentionIcon /><span><strong>{money(rep.outstanding)} to collect</strong><small>Completed work · {period}</small></span></Link>}
          {stockAlerts > 0 && <Link href="/admin/inventory" className={styles.attentionAction}><AttentionIcon /><span><strong>{stockAlerts} {stockAlerts === 1 ? "supply needs" : "supplies need"} restocking</strong></span></Link>}
          {!unassignedCount && !rep.outstanding && !stockAlerts && <div className={styles.caughtUp}><AttentionIcon complete /><span>You’re all caught up.</span></div>}
        </div><div className={styles.quickLinks}>{allowedSections.includes("schedule") && <Link href="/admin/schedule">Team schedule</Link>}{allowedSections.includes("payroll") && <Link href="/admin/payroll">Employee pay</Link>}{allowedSections.includes("leads") && <Link href="/admin/leads">Enquiries</Link>}</div>
      </aside>
    </div>
    {(canSeePayments || canSeeCosts) && <section className={styles.business} aria-labelledby="overview-financial-title">
      <div className={styles.reportBar}><h2 id="overview-financial-title">Financial overview</h2><div className={styles.reportControls}>
        <select className={styles.periodControl} aria-label="Overview reporting period" value={hasCustomDates ? "custom" : range} onChange={event => changePeriod(event.target.value)}>{hasCustomDates && <option value="custom">Custom dates</option>}<option value="1">Today</option><option value="yesterday">Yesterday</option><option value="week">This week</option><option value="month">This month</option><option value="last_month">Last month</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="year">This year</option></select>
        <details className={styles.datePicker}><summary>Choose dates</summary><form key={`${rep.start}:${rep.end}`} action="/admin/dashboard"><label>From<input name="from" type="date" defaultValue={rep.start} required /></label><label>To<input name="to" type="date" defaultValue={rep.end} required /></label><button type="submit" className="button">Apply dates</button></form></details>
      </div></div>
      {canSeeCosts && rep.financial_series ? <div className={styles.chartFrame}><ProfitChart series={rep.financial_series} /></div> : <div className={styles.operatingSummary}><div><span>Collected · {period}</span><strong>{money(rep.payments_collected)}</strong></div><div><span>Booked visits</span><strong>{number(rep.bookings.total)}</strong></div><div><span>Completed work</span><strong>{money(rep.net_sales)}</strong></div>{canSeePayments && <Link className={styles.actionPill} href="/admin/payments">View payments</Link>}</div>}
      <div className={styles.reportFooter}><span>{period}</span>{canSeeReports && <Link className={styles.quietLink} href={`/admin/reports?from=${rep.start}&to=${rep.end}`}>Reports &amp; exports</Link>}</div>
    </section>}
    {(canSeePayments || canSeeCosts) && <div className={styles.supporting}>
      {user.role === "manager" && canSeePayments && <OperationalDetails report={rep} period={period} today={today} />}
      {data.square != null && canSeePayments && <details className={styles.disclosure}><summary><strong>Square collections</strong><span>{money(rep.square.net)}</span></summary><div className={styles.disclosureBody}><SquareRevenue connection={data.square as Awaited<ReturnType<typeof squareRevenueStatus>>} summary={rep.square} /></div></details>}
      <details className={styles.disclosure}><summary><strong>About these numbers</strong></summary><div className={styles.definitions}><div><strong>Collected</strong><p>Verified payments received, less refunds. Deposits and tips are included. Processing fees are shown separately.</p></div><div><strong>Still to collect</strong><p>Unpaid service balances for work completed in the selected period. Deposits already paid reduce the balance.</p></div>{canSeeCosts && <div><strong>Operating result</strong><p>Collected revenue minus recorded expenses. Missing expenses affect this number; it is not a complete accounting profit statement.</p></div>}</div></details>
    </div>}
  </div>;
}
