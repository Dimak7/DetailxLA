import { database, type Query } from "./db";
import type { Row } from "./types";

export async function payrollSummary(start: string, end: string, transactionQuery?: Query, bookingId?: string) {
  // Job pay: final assignment override > service rule > all-services rule > employee default.
  // Percentage and flat rates are for a 100% job share; apply the share once. An
  // assignment override is already the employee's final amount. Tips stay separate.
  // A cart's final net price is allocated by its recorded service/addon amounts,
  // including proportional discounts. Specific rules apply to their own service;
  // the default/all-services flat rate applies once to the remaining job portion.
  const run = transactionQuery ?? (await database()).query;
  const { rows } = await run<Row>(
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
     ), job_value AS (
       SELECT b.id,b.service_id,b.price_cents,b.tip_cents,COALESCE(SUM(p.amount_cents-p.refunded_cents),0)::int paid,COUNT(p.id)::int payment_count
       FROM wl.bookings b LEFT JOIN wl.payments p ON p.booking_id=b.id AND p.status IN ('paid','partially_refunded','refunded')
       WHERE b.status='completed' AND b.booking_date BETWEEN $1::text AND $2::text AND ($3::uuid IS NULL OR b.id=$3) GROUP BY b.id
     ), assigned AS (
       SELECT a.booking_id,a.employee_id,a.pool_share_bps,a.commission_override_cents,a.tip_override_cents FROM wl.employee_job_assignments a
       UNION ALL
       SELECT b.id,e.id,10000,NULL,NULL FROM wl.bookings b JOIN wl.employees e ON e.user_id=b.assigned_to
       WHERE b.status='completed' AND b.booking_date BETWEEN $1::text AND $2::text AND ($3::uuid IS NULL OR b.id=$3) AND NOT EXISTS(SELECT 1 FROM wl.employee_job_assignments a WHERE a.booking_id=b.id)
     ), service_weights AS (
       SELECT j.id booking_id,COALESCE(li.service_id,j.service_id) service_id,
         SUM(li.quantity::bigint*li.unit_price_cents)::bigint weight
       FROM job_value j JOIN wl.booking_line_items li ON li.booking_id=j.id
       GROUP BY j.id,COALESCE(li.service_id,j.service_id)
       UNION ALL
       SELECT j.id,j.service_id,1::bigint FROM job_value j
       WHERE NOT EXISTS(SELECT 1 FROM wl.booking_line_items li WHERE li.booking_id=j.id)
     ), service_totals AS (
       SELECT sw.*,SUM(weight) OVER(PARTITION BY booking_id) total_weight,
         SUM(weight) OVER(PARTITION BY booking_id ORDER BY service_id) running_weight,
         ROW_NUMBER() OVER(PARTITION BY booking_id ORDER BY service_id) service_order
       FROM service_weights sw
     ), service_value AS (
       SELECT st.booking_id,st.service_id,
         CASE WHEN st.total_weight>0 THEN
           trunc(COALESCE(j.price_cents,j.paid,0)::numeric*st.running_weight/st.total_weight)
           -trunc(COALESCE(j.price_cents,j.paid,0)::numeric*(st.running_weight-st.weight)/st.total_weight)
         WHEN st.service_order=1 THEN COALESCE(j.price_cents,j.paid,0) ELSE 0 END amount_cents
       FROM service_totals st JOIN job_value j ON j.id=st.booking_id
     ), commission AS (
       SELECT a.employee_id,COUNT(*)::int jobs,COALESCE(SUM(CASE WHEN a.commission_override_cents IS NOT NULL THEN a.commission_override_cents
         WHEN (SELECT SUM(ax.pool_share_bps) FROM assigned ax WHERE ax.booking_id=a.booking_id)<>10000 THEN 0
         ELSE trunc(pay.job_pay*a.pool_share_bps/10000)::int END),0)::int commission_cents,COALESCE(SUM(CASE
           WHEN (SELECT count(*) FROM assigned ax WHERE ax.booking_id=a.booking_id AND ax.tip_override_cents IS NOT NULL)>0 THEN COALESCE(a.tip_override_cents,0)
           ELSE j.tip_cents/(SELECT count(*) FROM assigned ax WHERE ax.booking_id=a.booking_id) + CASE WHEN a.employee_id=(SELECT ax.employee_id FROM assigned ax WHERE ax.booking_id=a.booking_id ORDER BY ax.employee_id LIMIT 1) THEN j.tip_cents%(SELECT count(*) FROM assigned ax WHERE ax.booking_id=a.booking_id) ELSE 0 END
         END),0)::int tips_cents,COALESCE(SUM(COALESCE(j.price_cents,j.paid,0)::bigint*a.pool_share_bps::bigint/10000),0)::int attributed_revenue
       FROM assigned a JOIN job_value j ON j.id=a.booking_id JOIN wl.employees e ON e.id=a.employee_id
       LEFT JOIN LATERAL (
         SELECT r.rule_type,r.value FROM wl.employee_pay_rules r
         WHERE r.employee_id=e.id AND r.service_id IS NULL AND r.active=true
         ORDER BY r.updated_at DESC,r.id LIMIT 1
       ) r ON true
       CROSS JOIN LATERAL (
         SELECT COALESCE(SUM(CASE WHEN sr.rule_type='flat_job' THEN sr.value
           WHEN sr.rule_type='commission_percent' THEN sv.amount_cents*sr.value/10000 ELSE 0 END),0)
           + CASE WHEN COUNT(*) FILTER(WHERE sr.rule_type IS NULL)=0 THEN 0
             WHEN COALESCE(r.rule_type,CASE WHEN e.compensation_model='flat_job' THEN 'flat_job' ELSE 'commission_percent' END)='flat_job'
               THEN COALESCE(r.value,e.flat_job_pay_cents)
             WHEN r.rule_type='commission_percent' OR e.compensation_model IN ('commission','hourly_commission')
               THEN COALESCE(SUM(sv.amount_cents) FILTER(WHERE sr.rule_type IS NULL),0)*COALESCE(r.value,e.default_commission_bps)/10000
             ELSE 0 END job_pay
         FROM service_value sv LEFT JOIN LATERAL (
           SELECT pr.rule_type,pr.value FROM wl.employee_pay_rules pr
           WHERE pr.employee_id=e.id AND pr.service_id=sv.service_id AND pr.active=true
           ORDER BY pr.updated_at DESC,pr.id LIMIT 1
         ) sr ON true WHERE sv.booking_id=j.id
       ) pay
       GROUP BY a.employee_id
     ), adjustments AS (
       SELECT employee_id,COALESCE(SUM(amount_cents),0)::int adjustment_cents FROM wl.payroll_adjustments pa JOIN wl.pay_periods pp ON pp.id=pa.pay_period_id WHERE pp.start_date=$1::text AND pp.end_date=$2::text GROUP BY employee_id
     )
     SELECT e.id,e.name,e.position,e.hourly_rate_cents,e.compensation_model,h.minutes,h.actual_minutes,h.scheduled_minutes,h.paid_hours_source,COALESCE(c.jobs,0)::int jobs_completed,COALESCE(c.attributed_revenue,0)::int attributed_revenue,COALESCE(c.commission_cents,0)::int commission_cents,COALESCE(c.tips_cents,0)::int tips_cents,COALESCE(a.adjustment_cents,0)::int adjustment_cents,
       CASE WHEN e.compensation_model IN ('hourly','hourly_commission') THEN (h.minutes::bigint*e.hourly_rate_cents/60)::int ELSE 0 END hourly_earnings_cents,
       (CASE WHEN e.compensation_model IN ('hourly','hourly_commission') THEN (h.minutes::bigint*e.hourly_rate_cents/60)::int ELSE 0 END + COALESCE(c.commission_cents,0) + COALESCE(c.tips_cents,0) + COALESCE(a.adjustment_cents,0))::int total_earnings_cents,
       h.minutes::int regular_minutes,0::int overtime_minutes,
       (CASE WHEN e.compensation_model IN ('hourly','hourly_commission') THEN (h.minutes::bigint*e.hourly_rate_cents/60)::int ELSE 0 END + COALESCE(c.commission_cents,0) + COALESCE(c.tips_cents,0) + COALESCE(a.adjustment_cents,0))::int estimated_gross_cents
     FROM wl.employees e JOIN hours h ON h.id=e.id LEFT JOIN commission c ON c.employee_id=e.id LEFT JOIN adjustments a ON a.employee_id=e.id WHERE e.active=true OR h.minutes>0 OR c.employee_id IS NOT NULL ORDER BY e.name`,
    [start, end, bookingId || null],
  );
  return rows;
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
