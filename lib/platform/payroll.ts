import { database, type Query } from "./db";
import type { Row } from "./types";
import { calculateJobCompensation, type EmployeePayPlan, type EmployeeServicePayRule, type JobPayAssignment, type JobPayLine } from "./job-pay-calculation";

type PayEmployee = Row & EmployeePayPlan & { active: boolean; minutes: number; adjustment_cents: number; hourly_rate_cents: number };
type PayJob = {
  id: string; service_id: string; price_cents: number | null; paid_cents: number; tip_cents: number;
  tip_recipient_employee_id: string | null; assigned_to: string | null; line_items: JobPayLine[];
};
type PayAssignment = JobPayAssignment & { booking_id: string };

export async function payrollSummary(start: string, end: string, transactionQuery?: Query, bookingId?: string) {
  const run = transactionQuery ?? (await database()).query;
  const { rows: employees } = await run<PayEmployee>(
    `WITH actual_hours AS (
       SELECT e.id,count(t.id)::int actual_entries,COALESCE(SUM(GREATEST(0,round(EXTRACT(EPOCH FROM (t.clock_out-t.clock_in))/60)-t.break_minutes)),0)::int actual_minutes
       FROM wl.employees e LEFT JOIN wl.time_entries t ON t.employee_id=e.id AND t.clock_out IS NOT NULL AND (t.clock_in AT TIME ZONE 'America/Chicago')::date BETWEEN $1::date AND $2::date GROUP BY e.id
     ), scheduled_hours AS (
       SELECT e.id,COALESCE(SUM(GREATEST(0,s.end_minute-s.start_minute-s.break_minutes)),0)::int scheduled_minutes
       FROM wl.employees e LEFT JOIN wl.employee_shifts s ON s.employee_id=e.id AND s.status='scheduled' AND s.shift_date BETWEEN $1::text AND $2::text GROUP BY e.id
     ), hours AS (
       SELECT a.id,a.actual_minutes,s.scheduled_minutes,
         CASE WHEN a.actual_entries>0 THEN a.actual_minutes ELSE s.scheduled_minutes END::int minutes,
         CASE WHEN a.actual_entries>0 THEN 'actual_clocked' ELSE 'scheduled_fallback' END paid_hours_source
       FROM actual_hours a JOIN scheduled_hours s ON s.id=a.id
     ), adjustments AS (
       SELECT employee_id,COALESCE(SUM(amount_cents),0)::int adjustment_cents FROM wl.payroll_adjustments pa JOIN wl.pay_periods pp ON pp.id=pa.pay_period_id WHERE pp.start_date=$1::text AND pp.end_date=$2::text GROUP BY employee_id
     )
     SELECT e.id,e.user_id,e.name,e.position,e.active,e.hourly_rate_cents,e.compensation_model,e.default_commission_bps,e.flat_job_pay_cents,
       h.minutes,h.actual_minutes,h.scheduled_minutes,h.paid_hours_source,COALESCE(a.adjustment_cents,0)::int adjustment_cents
     FROM wl.employees e JOIN hours h ON h.id=e.id LEFT JOIN adjustments a ON a.employee_id=e.id ORDER BY e.name`,
    [start, end],
  );
  const { rows: jobs } = await run<PayJob>(
    `SELECT b.id,b.service_id,b.price_cents,b.tip_cents,b.tip_recipient_employee_id,b.assigned_to,
      COALESCE((SELECT SUM(p.amount_cents-p.refunded_cents) FROM wl.payments p WHERE p.booking_id=b.id AND p.status IN ('paid','partially_refunded','refunded')),0)::int paid_cents,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',li.id,'service_id',li.service_id,'name',li.name,'quantity',li.quantity,'unit_price_cents',li.unit_price_cents) ORDER BY li.id)
        FROM wl.booking_line_items li WHERE li.booking_id=b.id),'[]'::jsonb) line_items
     FROM wl.bookings b WHERE b.status='completed' AND b.booking_date BETWEEN $1::text AND $2::text AND ($3::uuid IS NULL OR b.id=$3) ORDER BY b.id`,
    [start, end, bookingId || null],
  );
  const { rows: assignments } = await run<PayAssignment>(
    "SELECT booking_id,employee_id,pool_share_bps,commission_override_cents,tip_override_cents,pay_type,pay_value,line_pay_rules FROM wl.employee_job_assignments WHERE booking_id=ANY($1::uuid[])",
    [jobs.map((job) => job.id)],
  );
  const { rows: rules } = await run<EmployeeServicePayRule>(
    "SELECT employee_id,service_id,rule_type,value FROM wl.employee_pay_rules WHERE active=true ORDER BY updated_at DESC,id",
  );
  const totals = new Map<string, { jobs_completed: number; commission_cents: number; tips_cents: number; attributed_revenue: number }>();
  const assignmentsByJob = new Map<string, PayAssignment[]>();
  for (const assignment of assignments) {
    const group = assignmentsByJob.get(assignment.booking_id) || [];
    group.push(assignment);
    assignmentsByJob.set(assignment.booking_id, group);
  }
  const employeesByUser = new Map(employees.filter((employee) => employee.user_id).map((employee) => [employee.user_id, employee]));
  for (const job of jobs) {
    let assigned = assignmentsByJob.get(job.id) || [];
    if (!assigned.length && job.assigned_to) {
      const employee = employeesByUser.get(job.assigned_to);
      if (employee) assigned = [{ booking_id: job.id, employee_id: employee.id, pool_share_bps: 10000 }];
    }
    const earnings = calculateJobCompensation({ ...job, assignments: assigned, employees, service_rules: rules });
    for (const result of earnings) {
      const total = totals.get(result.employee_id) || { jobs_completed: 0, commission_cents: 0, tips_cents: 0, attributed_revenue: 0 };
      total.jobs_completed += 1;
      total.commission_cents += result.commission_cents;
      total.tips_cents += result.tips_cents;
      total.attributed_revenue += result.attributed_revenue;
      totals.set(result.employee_id, total);
    }
  }
  return employees.filter((employee) => employee.active || employee.minutes > 0 || totals.has(employee.id)).map((employee): Row => {
    const total = totals.get(employee.id) || { jobs_completed: 0, commission_cents: 0, tips_cents: 0, attributed_revenue: 0 };
    const hourly = ["hourly", "hourly_commission"].includes(employee.compensation_model) ? Math.trunc(Number(employee.minutes) * Number(employee.hourly_rate_cents) / 60) : 0;
    const gross = hourly + total.commission_cents + total.tips_cents + Number(employee.adjustment_cents);
    return { ...employee, ...total, hourly_earnings_cents: hourly, total_earnings_cents: gross, estimated_gross_cents: gross, regular_minutes: employee.minutes, overtime_minutes: 0 };
  });
}

/** Keep completed job earnings stable when an employee earns a new rate. */
export async function preserveCompletedJobPay(q:Query,employeeId:string){
 const jobs=(await q<{id:string;booking_date:string;assignment_id:string|null}>(`SELECT b.id,b.booking_date,a.id assignment_id FROM wl.bookings b
 JOIN wl.employees e ON e.id=$1 LEFT JOIN wl.employee_job_assignments a ON a.booking_id=b.id AND a.employee_id=e.id
 WHERE b.status='completed' AND ((a.id IS NOT NULL AND a.commission_override_cents IS NULL)
 OR (b.assigned_to=e.user_id AND NOT EXISTS(SELECT 1 FROM wl.employee_job_assignments other WHERE other.booking_id=b.id))) ORDER BY b.id`,[employeeId])).rows;
 for(const job of jobs){
  await q("SELECT id FROM wl.bookings WHERE id=$1 FOR UPDATE",[job.id]);
  const earnings=(await payrollSummary(job.booking_date,job.booking_date,q,job.id)).find(row=>row.id===employeeId);
  if(!earnings)continue;
  if(job.assignment_id)await q("UPDATE wl.employee_job_assignments SET commission_override_cents=$2 WHERE id=$1 AND commission_override_cents IS NULL",[job.assignment_id,Number(earnings.commission_cents)]);
  else await q("INSERT INTO wl.employee_job_assignments(id,booking_id,employee_id,pool_share_bps,commission_override_cents) VALUES($1,$2,$3,10000,$4) ON CONFLICT(booking_id,employee_id) DO NOTHING",[(await import("node:crypto")).randomUUID(),job.id,employeeId,Number(earnings.commission_cents)]);
 }
}
