"use client";

import Link from "next/link";
import type { RecordData as R } from "./AdminControls";
import { JobPayments } from "./JobPayments";
import { money, timeLabel } from "@/lib/platform/types";
import styles from "./BookingList.module.css";

type BookingListProps = {
  records: R[];
  employees: R[];
  staff: boolean;
  canCollect: boolean;
  canViewCustomers: boolean;
  archived: boolean;
  squareEnvironment: string;
  onOpen: (row: R) => void;
};

const text = (value: unknown) => value == null ? "" : String(value);
const number = (value: unknown) => Number(value || 0);
const records = (value: unknown) => Array.isArray(value) ? value as R[] : [];
const statusLabel = (value: unknown) => text(value).replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());

function bookingDate(value: unknown) {
  const date = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date || "Date to be confirmed";
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(parsed);
}

export function BookingList({ records: bookings, employees, staff, canCollect, canViewCustomers, archived, squareEnvironment, onOpen }: BookingListProps) {
  if (!bookings.length) return <div className={styles.empty}>
    <span className={styles.emptyIcon} aria-hidden="true">◇</span>
    <h3>{archived ? "No archived bookings here" : "No bookings in this view"}</h3>
    <p>Try a different date or clear your filters to see more appointments.</p>
  </div>;

  return <div className={`${styles.list} ${staff ? styles.staffList : ""}`} aria-label="Bookings">
    <div className={styles.columnLabels} aria-hidden="true">
      <span>Customer &amp; service</span><span>Appointment</span>{!staff && <span>Team</span>}{!staff && <span>Service balance</span>}<span>Actions</span>
    </div>
    {bookings.map(booking => {
      const assignedNames = records(booking.job_assignments).map(assignment => text(assignment.name)).filter(Boolean);
      const assignedTo = text(booking.assigned_to);
      const fallbackName = assignedTo ? text(employees.find(employee => text(employee.user_id) === assignedTo)?.name) : "";
      const names = assignedNames.length ? assignedNames : fallbackName ? [fallbackName] : [];
      const total = booking.price_cents == null ? null : number(booking.price_cents);
      const collected = number(booking.collected_cents);
      const due = total === null ? null : Math.max(0, total - collected);
      const tips = number(booking.tip_cents);
      const customer = text(booking.customer_name) || "Customer";
      const initials = customer.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
      const status = text(booking.status);
      const duration = number(booking.duration_minutes);
      const durationLabel = duration >= 60 ? `${Math.floor(duration / 60)}h${duration % 60 ? ` ${duration % 60}m` : ""}` : `${duration}m`;
      return <article className={styles.row} key={text(booking.id)}>
        <div className={styles.customer}>
          <span className={styles.avatar} aria-hidden="true">{initials}</span>
          <div className={styles.customerBody}>
          <div className={styles.nameLine}>
            <h3>{canViewCustomers && !staff && booking.customer_id ? <Link href={`/admin/customers?id=${encodeURIComponent(text(booking.customer_id))}${archived ? "&archived=1" : ""}`}>{customer}</Link> : customer}</h3>
            <span className={styles.status} data-status={status}>{statusLabel(status) || "Not set"}</span>
          </div>
          {Boolean(booking.vehicle) && <p className={styles.vehicle}>{text(booking.vehicle)}</p>}
          <p className={styles.service}>{text(booking.service_name) || "Service to be confirmed"}</p>
          <div className={styles.reference}>{Boolean(booking.reference) && <span>{text(booking.reference)}</span>}{Boolean(booking.phone) && <span>{text(booking.phone)}</span>}</div>
          </div>
        </div>

        <div className={styles.appointment}>
          <span className={styles.mobileLabel}>Appointment</span>
          <strong>{bookingDate(booking.booking_date)}</strong>
          <span>{booking.start_minute == null ? "Time to be confirmed" : timeLabel(number(booking.start_minute))}{duration > 0 && <span className={styles.duration}> · {durationLabel}</span>}</span>
        </div>

        {!staff && <div className={styles.assignment}>
          <span className={styles.mobileLabel}>Team</span>
          {names.length ? <span className={styles.assignedNames}>{names.join(", ")}</span> : <span className={styles.unassigned}><span aria-hidden="true" />Unassigned</span>}
        </div>}

        {!staff && <div className={styles.balance}>
          <div className={styles.dueLine}><strong>{due === null ? "Quote pending" : money(due)}</strong><span>{due === null ? "Agree a price" : due === 0 ? "No balance due" : "to collect"}</span></div>
          <p>{total === null ? "Service price not set" : `${money(total)} service total`}</p>
          <p>{money(collected)} collected{tips > 0 ? ` · ${money(tips)} tip` : " · No tip recorded"}</p>
        </div>}

        <div className={styles.actions}>
          <button className="button" type="button" onClick={() => onOpen(booking)} aria-label={`Open job for ${customer}`}>Open job</button>
          {!staff && canCollect && <JobPayments booking={{ ...booking, square_environment: squareEnvironment }} />}
        </div>
      </article>;
    })}
  </div>;
}
