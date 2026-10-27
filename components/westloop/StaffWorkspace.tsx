"use client";

import type { RecordData as R } from "./AdminControls";
import { JobPhotos } from "./JobPhotos";
import { dateToday, timeLabel } from "@/lib/platform/types";
import styles from "./StaffWorkspace.module.css";

const rows = (value: unknown) => Array.isArray(value) ? value as R[] : [];
const text = (value: unknown) => value == null ? "" : String(value);
const number = (value: unknown) => Number(value || 0);
const dayLabel = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const timestamp = (value: unknown) => new Date(text(value)).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
const statusLabel = (value: unknown) => ({ new: "New", confirmed: "Booked", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled", no_show: "No-show" }[text(value)] || text(value));

export function StaffWorkspace({ data, busy, onClock, onViewJob, onJobStatus }: {
  data: R;
  busy: boolean;
  onClock: (action: string) => void;
  onViewJob: (job: R) => void;
  onJobStatus: (job: R, status: "in_progress" | "completed") => void;
}) {
  const today = dateToday();
  const appointments = rows(data.appointments);
  const todayJobs = appointments.filter(job => text(job.booking_date) === today).sort((a, b) => Number(a.status === "completed") - Number(b.status === "completed") || number(a.start_minute) - number(b.start_minute));
  const upcomingJobs = appointments.filter(job => text(job.booking_date) !== today);
  const shifts = rows(data.shifts);
  const todayShifts = shifts.filter(shift => text(shift.shift_date) === today);
  const entries = rows(data.entries);
  const active = entries.find(entry => !entry.clock_out);
  const onBreak = Boolean(active?.break_started_at);
  const completedToday = todayJobs.filter(job => job.status === "completed").length;

  function jobCards(jobs: R[]) {
    return <div className={styles.jobs}>{jobs.map(job => <article className={styles.job} key={text(job.id)}>
      <div className={styles.jobTime}><strong>{timeLabel(number(job.start_minute))}</strong><span>{text(job.booking_date) === today ? "Today" : dayLabel(text(job.booking_date))}</span><small>Until {timeLabel(number(job.start_minute) + number(job.duration_minutes))}</small></div>
      <div className={styles.jobContent}>
        <div className={styles.jobHeading}><div><h3>{text(job.customer_name) || "Customer"}</h3><p>{text(job.vehicle) || "Vehicle details pending"}</p></div><span className={styles.status} data-status={text(job.status)}>{statusLabel(job.status)}</span></div>
        <div className={styles.jobService}><strong>{text(job.service_name)}</strong><span>{text(job.reference)}</span></div>
        {(Boolean(job.location) || Boolean(job.notes) || Boolean(job.phone)) && <details className={styles.jobDetails}><summary>Location, contact &amp; notes</summary><div>{Boolean(job.location) && <p><strong>Location</strong>{text(job.location)}</p>}{Boolean(job.phone) && <p><strong>Customer phone</strong>{text(job.phone)}</p>}<p><strong>Notes</strong>{text(job.notes) || "No access notes"}</p></div></details>}
        <div className={styles.jobActions}>
          {job.status === "in_progress" ? <button type="button" className={`button ${styles.primary}`} disabled={busy} onClick={() => onJobStatus(job, "completed")}>Complete job</button> : !["completed", "cancelled", "no_show"].includes(text(job.status)) && <button type="button" className={`button ${styles.primary}`} disabled={busy} onClick={() => onJobStatus(job, "in_progress")}>Start job</button>}
          <button type="button" onClick={() => onViewJob(job)}>View job</button>
          <JobPhotos bookingId={text(job.id)} reference={text(job.reference)} />
        </div>
      </div>
    </article>)}</div>;
  }

  return <div className={styles.workspace}>
    <div className={styles.dayOverview}>
      <section className={styles.clock} aria-label="Today's shift and time clock">
        <div className={styles.clockInfo}><span className={styles.date}>{dayLabel(today)}</span><h2>{active ? onBreak ? "You’re on a break" : "You’re clocked in" : "Ready for your day"}</h2><p>{todayShifts.length ? todayShifts.map(shift => shift.status === "scheduled" ? `${timeLabel(number(shift.start_minute))} – ${timeLabel(number(shift.end_minute))}` : text(shift.status).replaceAll("_", " ")).join(" · ") : "No published shift for today"}</p>{active && <small>In since {timestamp(active.clock_in)}{onBreak ? ` · Break started ${timestamp(active.break_started_at)}` : ""}</small>}</div>
        <div className={styles.clockActions}>{!active ? <button type="button" className={`button ${styles.primary}`} disabled={busy} onClick={() => onClock("in")}>Clock in</button> : <><button type="button" disabled={busy} onClick={() => onClock(onBreak ? "break_end" : "break_start")}>{onBreak ? "End break" : "Start break"}</button><button type="button" className={`button ${styles.primary}`} disabled={busy || onBreak} onClick={() => onClock("out")}>Clock out</button></>}{onBreak && <small>End your break before clocking out.</small>}</div>
      </section>
      <div className={styles.dayCounts} aria-label="Your jobs today"><div><span>Assigned today</span><strong>{todayJobs.length}</strong></div><div><span>Completed today</span><strong>{completedToday}</strong></div></div>
    </div>

    <section className={styles.today} aria-labelledby="staff-today-jobs"><div className={styles.sectionHeading}><h2 id="staff-today-jobs">Your jobs today</h2><span>Chicago time</span></div>{todayJobs.length ? jobCards(todayJobs) : <div className={styles.empty}><strong>Your day is clear.</strong><p>New assignments from your manager will appear here.</p></div>}</section>

    {upcomingJobs.length > 0 && <details className={styles.disclosure} open={todayJobs.length === 0 ? true : undefined}><summary><span>Upcoming jobs</span><small>{upcomingJobs.length} assigned</small></summary><div className={styles.disclosureBody}>{jobCards(upcomingJobs)}</div></details>}

    <details className={styles.disclosure}><summary><span>Your published shifts</span><small>{shifts.length ? `${shifts.length} upcoming` : "No shifts yet"}</small></summary><div className={styles.shiftList}>{shifts.length ? shifts.map(shift => <article className={styles.shift} key={text(shift.id)}><div><strong>{text(shift.shift_date) === today ? "Today" : dayLabel(text(shift.shift_date))}</strong><span>{shift.status === "scheduled" ? `${timeLabel(number(shift.start_minute))} – ${timeLabel(number(shift.end_minute))}` : text(shift.status).replaceAll("_", " ")}</span></div><small>{number(shift.break_minutes) ? `${number(shift.break_minutes)} min break` : "No scheduled break"}</small>{Boolean(shift.notes) && <p>{text(shift.notes)}</p>}</article>) : <p className={styles.emptyNote}>Your manager will publish your shifts here.</p>}</div></details>

    <details className={styles.disclosure}><summary><span>Recent time entries</span><small>{entries.length ? `${entries.length} entries` : "No entries yet"}</small></summary><div className={styles.entries}>{entries.length ? entries.map(entry => <article key={text(entry.id)}><div><strong>{timestamp(entry.clock_in)}</strong><span>{entry.clock_out ? `Out ${timestamp(entry.clock_out)}` : "Currently clocked in"}</span></div><div><strong>{(number(entry.worked_minutes) / 60).toFixed(2)}h</strong><span>{number(entry.break_minutes)} min break</span></div></article>) : <p className={styles.emptyNote}>Clock in to start your first time entry.</p>}</div></details>
  </div>;
}
