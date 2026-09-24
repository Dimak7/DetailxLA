import { query } from "./db";
import type { Row } from "./types";

export async function payrollSummary(start: string, end: string) {
  const rows = await query<Row>(
    `WITH actual_hours AS (
       SELECT e.id,COALESCE(SUM(GREATEST(0,round(EXTRACT(EPOCH FROM (t.clock_out-t.clock_in))/60)-t.break_minutes)),0)::int actual_minutes
       FROM wl.employees e LEFT JOIN wl.time_entries t ON t.employee_id=e.id AND t.clock_out IS NOT NULL AND (t.clock_in AT TIME ZONE 'America/Chicago')::date BETWEEN $1::date AND $2::date GROUP BY e.id
     ), scheduled_hours AS (
       SELECT e.id,COALESCE(SUM(GREATEST(0,s.end_minute-s.start_minute-s.break_minutes)),0)::int scheduled_minutes
       FROM wl.employees e LEFT JOIN wl.employee_shifts s ON s.employee_id=e.id AND s.status='scheduled' AND s.shift_date BETWEEN $1::text AND $2::text GROUP BY e.id
     ), hours AS (
       SELECT a.id,a.actual_minutes,s.scheduled_minutes,
         CASE WHEN a.actual_minutes>0 THEN a.actual_minutes ELSE s.scheduled_minutes END::int minutes,
         CASE WHEN a.actual_minutes>0 THEN 'actual_clocked' ELSE 'scheduled_fallback' END paid_hours_source
       FROM actual_hours a JOIN scheduled_hours s ON s.id=a.id
     ), job_value AS (
       SELECT b.id,b.service_id,b.price_cents,b.tip_cents,COALESCE(SUM(p.amount_cents-p.refunded_cents),0)::int paid,COUNT(p.id)::int payment_count
       FROM wl.bookings b LEFT JOIN wl.payments p ON p.booking_id=b.id AND p.status IN ('paid','partially_refunded','refunded')
       WHERE b.status='completed' AND b.booking_date BETWEEN $1::text AND $2::text GROUP BY b.id
     ), assigned AS (
       SELECT a.booking_id,a.employee_id,a.pool_share_bps,a.commission_override_cents,a.tip_override_cents FROM wl.employee_job_assignments a
       UNION ALL
       SELECT b.id,e.id,10000,NULL,NULL FROM wl.bookings b JOIN wl.employees e ON e.user_id=b.assigned_to
       WHERE b.status='completed' AND b.booking_date BETWEEN $1::text AND $2::text AND NOT EXISTS(SELECT 1 FROM wl.employee_job_assignments a WHERE a.booking_id=b.id)
     ), commission AS (
       SELECT a.employee_id,COUNT(*)::int jobs,COALESCE(SUM(CASE WHEN (SELECT SUM(ax.pool_share_bps) FROM assigned ax WHERE ax.booking_id=a.booking_id)<>10000 THEN 0 WHEN a.commission_override_cents IS NOT NULL THEN a.commission_override_cents
         WHEN lower(e.position)='detailer' THEN ((CASE WHEN j.payment_count>0 THEN j.paid ELSE COALESCE(j.price_cents,0) END)::bigint*3000*a.pool_share_bps::bigint/100000000)::int
         WHEN COALESCE(r.rule_type, CASE WHEN e.compensation_model='flat_job' THEN 'flat_job' ELSE 'commission_percent' END)='flat_job' THEN (COALESCE(r.value,e.flat_job_pay_cents)::bigint*a.pool_share_bps::bigint/10000)::int
         WHEN e.compensation_model IN ('commission','hourly_commission') THEN ((CASE WHEN j.payment_count>0 THEN j.paid ELSE COALESCE(j.price_cents,0) END)::bigint*COALESCE(r.value,e.default_commission_bps)::bigint*a.pool_share_bps::bigint/100000000)::int
         ELSE 0 END),0)::int commission_cents,COALESCE(SUM(CASE
           WHEN (SELECT count(*) FROM assigned ax WHERE ax.booking_id=a.booking_id AND ax.tip_override_cents IS NOT NULL)>0 THEN COALESCE(a.tip_override_cents,0)
           ELSE j.tip_cents/(SELECT count(*) FROM assigned ax WHERE ax.booking_id=a.booking_id) + CASE WHEN a.employee_id=(SELECT ax.employee_id FROM assigned ax WHERE ax.booking_id=a.booking_id ORDER BY ax.employee_id LIMIT 1) THEN j.tip_cents%(SELECT count(*) FROM assigned ax WHERE ax.booking_id=a.booking_id) ELSE 0 END
         END),0)::int tips_cents,COALESCE(SUM((CASE WHEN j.payment_count>0 THEN j.paid ELSE COALESCE(j.price_cents,0) END)*a.pool_share_bps/10000),0)::int attributed_revenue
       FROM assigned a JOIN job_value j ON j.id=a.booking_id JOIN wl.employees e ON e.id=a.employee_id
       LEFT JOIN wl.employee_pay_rules r ON r.employee_id=e.id AND r.service_id=j.service_id AND r.active=true AND ((r.rule_type='flat_job' AND e.compensation_model='flat_job') OR (r.rule_type='commission_percent' AND e.compensation_model<>'flat_job'))
       GROUP BY a.employee_id
     ), adjustments AS (
       SELECT employee_id,COALESCE(SUM(amount_cents),0)::int adjustment_cents FROM wl.payroll_adjustments pa JOIN wl.pay_periods pp ON pp.id=pa.pay_period_id WHERE pp.start_date=$1::text AND pp.end_date=$2::text GROUP BY employee_id
     )
     SELECT e.id,e.name,e.position,CASE WHEN lower(e.position)='detailer' THEN 1000 ELSE e.hourly_rate_cents END hourly_rate_cents,CASE WHEN lower(e.position)='detailer' THEN 'hourly_commission' ELSE e.compensation_model END compensation_model,h.minutes,h.actual_minutes,h.scheduled_minutes,h.paid_hours_source,COALESCE(c.jobs,0)::int jobs_completed,COALESCE(c.attributed_revenue,0)::int attributed_revenue,COALESCE(c.commission_cents,0)::int commission_cents,COALESCE(c.tips_cents,0)::int tips_cents,COALESCE(a.adjustment_cents,0)::int adjustment_cents,
       CASE WHEN lower(e.position)='detailer' OR e.compensation_model IN ('hourly','hourly_commission') THEN (h.minutes*(CASE WHEN lower(e.position)='detailer' THEN 1000 ELSE e.hourly_rate_cents END)/60)::int ELSE 0 END hourly_earnings_cents,
       (CASE WHEN lower(e.position)='detailer' OR e.compensation_model IN ('hourly','hourly_commission') THEN (h.minutes*(CASE WHEN lower(e.position)='detailer' THEN 1000 ELSE e.hourly_rate_cents END)/60)::int ELSE 0 END + COALESCE(c.commission_cents,0) + COALESCE(c.tips_cents,0) + COALESCE(a.adjustment_cents,0))::int total_earnings_cents,
       h.minutes::int regular_minutes,0::int overtime_minutes,
       (CASE WHEN lower(e.position)='detailer' OR e.compensation_model IN ('hourly','hourly_commission') THEN (h.minutes*(CASE WHEN lower(e.position)='detailer' THEN 1000 ELSE e.hourly_rate_cents END)/60)::int ELSE 0 END + COALESCE(c.commission_cents,0) + COALESCE(c.tips_cents,0) + COALESCE(a.adjustment_cents,0))::int estimated_gross_cents
     FROM wl.employees e JOIN hours h ON h.id=e.id LEFT JOIN commission c ON c.employee_id=e.id LEFT JOIN adjustments a ON a.employee_id=e.id WHERE e.active=true OR h.minutes>0 OR c.employee_id IS NOT NULL ORDER BY e.name`,
    [start, end],
  );
  return rows;
}
