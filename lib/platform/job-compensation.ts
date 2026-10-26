import { randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction } from "./db";
import { AppError } from "./auth";
import type { JobLinePayRule, JobPayType } from "./job-pay-calculation";

const rate = z.number().int().min(0).max(100000000);
const lineRule = z.object({ line_item_id: z.string().uuid(), pay_type: z.enum(["percentage", "flat"]), pay_value: rate })
  .refine((row) => row.pay_type !== "percentage" || row.pay_value <= 10000, "A percentage must be between 0% and 100%.");
const assignmentSchema = z.object({
  employee_id: z.string().uuid(),
  pool_share_bps: z.number().int().min(0).max(10000),
  pay_type: z.enum(["default", "percentage", "flat"]).default("default"),
  pay_value: rate.default(0),
  line_rules: z.array(lineRule).max(100).default([]),
  notes: z.string().max(2000).default(""),
}).refine((row) => row.pay_type !== "percentage" || row.pay_value <= 10000, "A percentage must be between 0% and 100%.");
export const jobCompensationSchema = z.object({
  booking_id: z.string().uuid(),
  assignment_override: z.boolean().default(false),
  tip_recipient_employee_id: z.string().uuid().nullable().optional(),
  assignments: z.array(assignmentSchema).max(20),
});

type SavedAssignment = {
  employee_id: string; pool_share_bps: number; commission_override_cents: number | null;
  pay_type: JobPayType; pay_value: number; line_pay_rules: JobLinePayRule[];
};
const normalizedRules = (rules: JobLinePayRule[]) => JSON.stringify([...rules].sort((a, b) => a.line_item_id.localeCompare(b.line_item_id)));

/** Authorization belongs to the settings/payroll-gated admin action dispatcher. */
export async function saveJobCompensation(value: unknown, actorId: string) {
  const input = jobCompensationSchema.parse(value);
  const ids = input.assignments.map((row) => row.employee_id);
  if (new Set(ids).size !== ids.length) throw new AppError("Choose each detailer only once.");
  if (input.assignments.length && input.assignments.reduce((sum, row) => sum + row.pool_share_bps, 0) !== 10000)
    throw new AppError("The default-plan job shares must add up to 100%.");
  const recipient = ids.length === 0 ? null : ids.length === 1 ? ids[0] : input.tip_recipient_employee_id || null;
  if ((ids.length > 1 && !recipient) || (recipient && !ids.includes(recipient)))
    throw new AppError("Choose the assigned detailer who receives this job's full tip.");
  return transaction(async (q) => {
    // Assignment changes share the scheduling lock with booking creation/moves.
    await q("SELECT id FROM wl.schedule_guard WHERE id=1 FOR UPDATE");
    const booking = (await q<{ id: string; booking_date: string; assigned_to: string | null; start_minute: number; duration_minutes: number; status: string; tip_recipient_employee_id: string | null }>(
      "SELECT id,booking_date,assigned_to,start_minute,duration_minutes,status,tip_recipient_employee_id FROM wl.bookings WHERE id=$1 FOR UPDATE", [input.booking_id],
    )).rows[0];
    if (!booking) throw new AppError("Booking not found.", 404);
    const previous = (await q<SavedAssignment>("SELECT employee_id,pool_share_bps,commission_override_cents,pay_type,pay_value,line_pay_rules FROM wl.employee_job_assignments WHERE booking_id=$1 FOR UPDATE", [input.booking_id])).rows;
    const affected = [...new Set([...ids, ...previous.map((row) => row.employee_id)])];
    const paidPeriod = (await q(`SELECT pp.id FROM wl.pay_periods pp JOIN wl.payroll_records pl ON pl.pay_period_id=pp.id JOIN wl.employees e ON e.id=pl.employee_id
      WHERE pp.status='paid' AND $1::text BETWEEN pp.start_date AND pp.end_date AND (pl.employee_id=ANY($2::uuid[]) OR e.user_id=$3) LIMIT 1`, [booking.booking_date, affected, booking.assigned_to])).rows[0];
    if (paidPeriod) throw new AppError("This job is in a paid payroll period. Record a payroll adjustment instead of changing the original pay.", 409);
    const employees = (await q<{ id: string; user_id: string | null; name: string; active: boolean; login_active: boolean | null; removed_at: string | null }>(
      "SELECT e.id,e.user_id,e.name,e.active,u.active login_active,u.removed_at FROM wl.employees e LEFT JOIN wl.users u ON u.id=e.user_id WHERE e.id=ANY($1::uuid[]) FOR UPDATE OF e", [ids],
    )).rows;
    if (employees.length !== ids.length || employees.some((row) => !row.active || row.login_active === false || row.removed_at)) throw new AppError("Choose active team members with active login access only.");
    const warnings: string[] = [];
    const newlyAssigned = employees.filter(employee => !previous.some(row => row.employee_id === employee.id) && (!employee.user_id || employee.user_id !== booking.assigned_to));
    if (newlyAssigned.length && ["cancelled", "no_show"].includes(booking.status)) throw new AppError("Reopen this job before assigning a new detailer.");
    const end = booking.start_minute + booking.duration_minutes;
    for (const employee of newlyAssigned) {
      const conflict = (await q<{ reference: string }>(
        `SELECT b.reference FROM wl.bookings b WHERE b.id<>$1 AND b.booking_date=$2 AND b.status NOT IN ('cancelled','no_show')
         AND b.start_minute<$4 AND b.start_minute+b.duration_minutes>$3
         AND (b.assigned_to=$5 OR EXISTS(SELECT 1 FROM wl.employee_job_assignments a WHERE a.booking_id=b.id AND a.employee_id=$6))
         ORDER BY b.start_minute LIMIT 1`, [booking.id, booking.booking_date, booking.start_minute, end, employee.user_id, employee.id],
      )).rows[0];
      if (conflict) warnings.push(`${employee.name} is already assigned to ${conflict.reference} during these hours.`);
      const dated = (await q<{ status: string; start_minute: number; end_minute: number }>(
        "SELECT status,start_minute,end_minute FROM wl.employee_shifts WHERE employee_id=$1 AND shift_date=$2 ORDER BY updated_at DESC", [employee.id, booking.booking_date],
      )).rows;
      const override = dated.find(shift => shift.status !== "scheduled");
      const covered = !override && dated.some(shift => shift.status === "scheduled" && shift.start_minute <= booking.start_minute && shift.end_minute >= end);
      const recurring = dated.length ? null : (await q<{ available: boolean; start_minute: number; end_minute: number }>(
        "SELECT available,start_minute,end_minute FROM wl.employee_availability WHERE employee_id=$1 AND weekday=$2", [employee.id, new Date(booking.booking_date + "T12:00:00Z").getUTCDay()],
      )).rows[0];
      if (override) warnings.push(`${employee.name} has a ${override.status.toUpperCase()} date override.`);
      else if (!covered && !(recurring?.available && recurring.start_minute <= booking.start_minute && recurring.end_minute >= end))
        warnings.push(`${employee.name} is not scheduled for the full job hours.`);
    }
    if (warnings.length && !input.assignment_override)
      throw new AppError(`Assignment warning: ${warnings.join(" ")} Review the schedule or select the manager override.`);
    const lines = (await q<{ id: string }>("SELECT id FROM wl.booking_line_items WHERE booking_id=$1 FOR UPDATE", [input.booking_id])).rows;
    const allowed = new Set(lines.map((line) => line.id));
    for (const row of input.assignments) {
      if (new Set(row.line_rules.map((rule) => rule.line_item_id)).size !== row.line_rules.length)
        throw new AppError("Choose only one pay rate per service or upgrade for each detailer.");
      if (row.line_rules.some((rule) => !allowed.has(rule.line_item_id))) throw new AppError("A pay rate references a service that is not part of this job. Refresh the booking.");
      const old = previous.find((assignment) => assignment.employee_id === row.employee_id);
      const samePay = old && old.pool_share_bps === row.pool_share_bps && old.pay_type === row.pay_type && old.pay_value === row.pay_value && normalizedRules(old.line_pay_rules) === normalizedRules(row.line_rules);
      const finalOverride = samePay ? old.commission_override_cents : null;
      await q(`INSERT INTO wl.employee_job_assignments(id,booking_id,employee_id,pool_share_bps,commission_override_cents,tip_override_cents,notes,assigned_by,pay_type,pay_value,line_pay_rules)
        VALUES($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10::jsonb)
        ON CONFLICT(booking_id,employee_id) DO UPDATE SET pool_share_bps=$4,commission_override_cents=$5,tip_override_cents=NULL,notes=$6,assigned_by=$7,pay_type=$8,pay_value=$9,line_pay_rules=$10::jsonb`,
      [randomUUID(), input.booking_id, row.employee_id, row.pool_share_bps, finalOverride, row.notes, actorId, row.pay_type, row.pay_value, JSON.stringify(row.line_rules)]);
    }
    await q("DELETE FROM wl.employee_job_assignments WHERE booking_id=$1 AND NOT(employee_id=ANY($2::uuid[]))", [input.booking_id, ids]);
    const primary = employees.find((employee) => employee.id === ids[0])?.user_id || null;
    await q("UPDATE wl.bookings SET assigned_to=$2,tip_recipient_employee_id=$3,updated_at=now() WHERE id=$1", [input.booking_id, primary, recipient]);
    if (warnings.length) await q("INSERT INTO wl.audit_logs(id,actor_id,entity_type,entity_id,action,after_data) VALUES($1,$2,'booking',$3,'assignment_override',$4::jsonb)",
      [randomUUID(), actorId, input.booking_id, JSON.stringify({ employee_ids: newlyAssigned.map(employee => employee.id), warnings, date: booking.booking_date, start: booking.start_minute })]);
    await q("INSERT INTO wl.audit_logs(id,actor_id,entity_type,entity_id,action,before_data,after_data) VALUES($1,$2,'job_compensation',$3,'saved',$4::jsonb,$5::jsonb)",
      [randomUUID(), actorId, input.booking_id, JSON.stringify({ assignments: previous, tip_recipient_employee_id: booking.tip_recipient_employee_id }), JSON.stringify({ ...input, tip_recipient_employee_id: recipient })]);
    return { ok: true, tip_recipient_employee_id: recipient };
  });
}
