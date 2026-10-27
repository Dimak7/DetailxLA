import { z } from "zod";
import { access, AppError } from "./auth";
import { validDate } from "./bookings";
import { query } from "./db";
import { calculateJobCompensation, type EmployeePayPlan, type EmployeeServicePayRule, type JobPayAssignment, type JobPayBreakdown, type JobPayLine } from "./job-pay-calculation";
import type { Session } from "./types";

const statuses = ["all", "new", "confirmed", "in_progress", "completed", "cancelled", "no_show"] as const;
const filtersSchema = z.object({
  employee_id: z.uuid("Choose a valid employee."),
  start: z.string().default(""),
  end: z.string().default(""),
  status: z.enum(statuses).default("all"),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});

export type EmployeeHistoryLine = JobPayBreakdown & { rate_label: string };
export type EmployeeHistoryJob = {
  id: string; reference: string; booking_date: string; start_minute: number; duration_minutes: number;
  status: string; customer_name: string; vehicle: string; service_name: string;
  service_total_cents: number | null; job_pay_cents: number; tips_cents: number; total_earnings_cents: number;
  earned: boolean; quote_pending: boolean; pay_note: string | null; lines: EmployeeHistoryLine[];
};
export type EmployeeJobHistory = {
  employee: { id: string; name: string; position: string; active: boolean };
  filters: { start: string | null; end: string | null; status: typeof statuses[number] };
  summary: {
    completed_jobs: number; service_total_cents: number; job_pay_cents: number; tips_cents: number; total_earnings_cents: number;
    pending_jobs: number; pending_job_pay_cents: number;
  };
  jobs: EmployeeHistoryJob[];
  pagination: { page: number; page_size: number; total: number; total_pages: number };
};

type Employee = EmployeePayPlan & { user_id: string | null; name: string; position: string; active: boolean };
type Assignment = JobPayAssignment & { booking_id: string };
type HistoryJob = {
  id: string; reference: string; booking_date: string; start_minute: number; duration_minutes: number; status: string;
  customer_name: string; vehicle: string; service_name: string; service_id: string; assigned_to: string | null;
  price_cents: number | null; paid_cents: number; tip_cents: number; tip_recipient_employee_id: string | null;
  line_items: (JobPayLine & { quote_pending: boolean })[];
};

const dollars = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(cents / 100);
const percent = (bps: number) => `${Number(bps) / 100}%`;

function rateLabel(line: JobPayBreakdown, job: HistoryJob, assignment: Assignment, employee: Employee, rules: EmployeeServicePayRule[]) {
  if (line.source === "saved_amount") return "Saved job pay · allocated to this line";
  const override = assignment.line_pay_rules?.find(rule => rule.line_item_id === line.line_item_id);
  if (line.source === "line_rate" && override)
    return override.pay_type === "flat" ? `${dollars(override.pay_value)} flat for this line` : `${percent(override.pay_value)} of this line`;
  if (line.source === "job_rate")
    return assignment.pay_type === "flat" ? `${dollars(assignment.pay_value || 0)} flat job pay · allocated` : `${percent(assignment.pay_value || 0)} job rate`;
  const ownRules = rules.filter(rule => rule.employee_id === employee.id);
  const serviceId = job.line_items.find(item => item.id === line.line_item_id)?.service_id || job.service_id;
  const rule = ownRules.find(item => item.service_id === serviceId) || ownRules.find(item => item.service_id === null);
  const share = Number(assignment.pool_share_bps) === 10000 ? "" : ` × ${percent(assignment.pool_share_bps)} team share`;
  if (rule)
    return rule.rule_type === "flat_job" ? `${dollars(rule.value)} flat service rule${share} · allocated` : `${percent(rule.value)} service rule${share}`;
  if (employee.compensation_model === "flat_job") return `${dollars(employee.flat_job_pay_cents)} flat job pay${share} · allocated`;
  if (["commission", "hourly_commission"].includes(employee.compensation_model)) return `${percent(employee.default_commission_bps)} employee rate${share}`;
  return "Hourly pay tracked separately";
}

/** Read-only detail using the same calculator and assignment fallback as payroll. */
export async function employeeJobHistory(raw: unknown, user: Session): Promise<EmployeeJobHistory> {
  if (!access.payroll.includes(user.role)) throw new AppError("Your role does not have access to employee job pay.", 403);
  const input = filtersSchema.parse(raw);
  if ((input.start && !validDate(input.start)) || (input.end && !validDate(input.end)) || (input.start && input.end && input.start > input.end))
    throw new AppError("Choose a valid date range.");
  const employees = await query<Employee>("SELECT id,user_id,name,position,active,compensation_model,default_commission_bps,flat_job_pay_cents FROM wl.employees");
  const employee = employees.find(row => row.id === input.employee_id);
  if (!employee) throw new AppError("Employee not found.", 404);
  const jobs = await query<HistoryJob>(
    `SELECT b.id,b.reference,b.booking_date,b.start_minute,b.duration_minutes,b.status,b.service_name,b.service_id,b.assigned_to,
       b.price_cents,b.tip_cents,b.tip_recipient_employee_id,c.first_name||' '||c.last_name customer_name,
       concat_ws(' ',v.year,v.make,v.model) vehicle,
       COALESCE((SELECT SUM(p.amount_cents-p.refunded_cents) FROM wl.payments p WHERE p.booking_id=b.id AND p.status IN ('paid','partially_refunded','refunded')),0)::int paid_cents,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('id',li.id,'service_id',li.service_id,'name',li.name,'quantity',li.quantity,'unit_price_cents',li.unit_price_cents,'quote_pending',li.quote_pending) ORDER BY CASE WHEN li.kind='base_service' THEN 0 ELSE 1 END,li.created_at,li.id)
         FROM wl.booking_line_items li WHERE li.booking_id=b.id),'[]'::jsonb) line_items
     FROM wl.bookings b JOIN wl.customers c ON c.id=b.customer_id JOIN wl.vehicles v ON v.id=b.vehicle_id
     WHERE c.archived_at IS NULL AND
       (EXISTS(SELECT 1 FROM wl.employee_job_assignments a WHERE a.booking_id=b.id AND a.employee_id=$1)
        OR (b.assigned_to=$2::uuid AND NOT EXISTS(SELECT 1 FROM wl.employee_job_assignments a WHERE a.booking_id=b.id)))
       AND ($3::text='' OR b.booking_date>=$3) AND ($4::text='' OR b.booking_date<=$4)
       AND ($5::text='all' OR b.status=$5)
     ORDER BY b.booking_date DESC,b.start_minute DESC,b.id DESC`,
    [employee.id, employee.user_id, input.start, input.end, input.status],
  );
  const assignments = jobs.length ? await query<Assignment>(
    "SELECT booking_id,employee_id,pool_share_bps,commission_override_cents,tip_override_cents,pay_type,pay_value,line_pay_rules FROM wl.employee_job_assignments WHERE booking_id=ANY($1::uuid[])", [jobs.map(job => job.id)],
  ) : [];
  const rules = jobs.length ? await query<EmployeeServicePayRule>("SELECT employee_id,service_id,rule_type,value FROM wl.employee_pay_rules WHERE active=true ORDER BY updated_at DESC,id") : [];
  const assignmentsByJob = new Map<string, Assignment[]>();
  for (const assignment of assignments) assignmentsByJob.set(assignment.booking_id, [...(assignmentsByJob.get(assignment.booking_id) || []), assignment]);
  const history = jobs.map((job): EmployeeHistoryJob => {
    const assigned = assignmentsByJob.get(job.id) || [{ booking_id: job.id, employee_id: employee.id, pool_share_bps: 10000 }];
    const mine = assigned.find(row => row.employee_id === employee.id)!;
    const result = calculateJobCompensation({ ...job, assignments: assigned, employees, service_rules: rules }).find(row => row.employee_id === employee.id)!;
    const earned = job.status === "completed";
    const cancelled = ["cancelled", "no_show"].includes(job.status);
    const quotePending = job.price_cents === null;
    const notes: string[] = [];
    if (mine.commission_override_cents != null) notes.push("Saved job pay is preserved. Its per-service amounts are a proportional breakdown, not a record of historical line rates.");
    if (quotePending) notes.push("No agreed service price is saved. Pay is provisional and follows payroll's recorded-payment fallback.");
    if (cancelled) notes.push("This appointment does not count toward earned job pay or tips.");
    else if (!earned) notes.push("Estimated pay only. This job counts toward earnings when marked completed.");
    // The calculator orders by ID for cent allocation. Display the original service order.
    const lines = (job.line_items.length ? job.line_items.map(item => result.lines.find(line => line.line_item_id === item.id)!) : result.lines)
      .map(line => ({ ...line, name: job.line_items.length ? line.name : job.service_name, pay_cents: cancelled ? 0 : line.pay_cents, rate_label: rateLabel(line, job, mine, employee, rules) }));
    return {
      id: job.id, reference: job.reference, booking_date: job.booking_date, start_minute: Number(job.start_minute), duration_minutes: Number(job.duration_minutes),
      status: job.status, customer_name: job.customer_name, vehicle: job.vehicle, service_name: job.service_name,
      service_total_cents: job.price_cents === null ? null : Number(job.price_cents),
      job_pay_cents: cancelled ? 0 : result.commission_cents, tips_cents: cancelled ? 0 : result.tips_cents,
      total_earnings_cents: cancelled ? 0 : result.commission_cents + result.tips_cents,
      earned, quote_pending: quotePending, pay_note: notes.length ? notes.join(" ") : null, lines,
    };
  });
  const summary = { completed_jobs: 0, service_total_cents: 0, job_pay_cents: 0, tips_cents: 0, total_earnings_cents: 0, pending_jobs: 0, pending_job_pay_cents: 0 };
  for (const job of history) {
    if (job.earned) {
      summary.completed_jobs++;
      summary.service_total_cents += job.service_total_cents || 0;
      summary.job_pay_cents += job.job_pay_cents;
      summary.tips_cents += job.tips_cents;
      summary.total_earnings_cents += job.total_earnings_cents;
    } else if (["new", "confirmed", "in_progress"].includes(job.status)) {
      summary.pending_jobs++;
      summary.pending_job_pay_cents += job.job_pay_cents;
    }
  }
  const pageSize = 25, totalPages = Math.max(1, Math.ceil(history.length / pageSize)), page = Math.min(input.page, totalPages);
  return {
    employee: { id: employee.id, name: employee.name, position: employee.position, active: employee.active },
    filters: { start: input.start || null, end: input.end || null, status: input.status }, summary,
    jobs: history.slice((page - 1) * pageSize, page * pageSize),
    pagination: { page, page_size: pageSize, total: history.length, total_pages: totalPages },
  };
}
