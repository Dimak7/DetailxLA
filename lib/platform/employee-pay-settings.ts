import { access, AppError } from "./auth";
import { query } from "./db";
import type { Session } from "./types";
import type { EmployeePaySettingsData, PaySettingsEmployee, PaySettingsRule, PaySettingsService } from "./pay-plan-display";

/** Read-only configuration, deliberately separate from earnings or payroll calculation. */
export async function employeePaySettings(user: Session): Promise<EmployeePaySettingsData> {
  if (!access.payroll.includes(user.role)) throw new AppError("Your role does not have access to employee pay settings.", 403);
  const [employees, services, rules] = await Promise.all([
    query<PaySettingsEmployee>("SELECT id,name,position,active,hourly_rate_cents,compensation_model,default_commission_bps,flat_job_pay_cents FROM wl.employees ORDER BY active DESC,name,id"),
    query<PaySettingsService>("SELECT id,name,active,sort_order FROM wl.services s WHERE s.active=true OR EXISTS(SELECT 1 FROM wl.employee_pay_rules r WHERE r.service_id=s.id) ORDER BY s.sort_order,s.name,s.id"),
    query<Omit<PaySettingsRule, "updated_at"> & { updated_at: string | Date }>("SELECT r.id,r.employee_id,e.name employee_name,r.service_id,s.name service_name,r.rule_type,r.value,r.active,r.updated_at FROM wl.employee_pay_rules r JOIN wl.employees e ON e.id=r.employee_id LEFT JOIN wl.services s ON s.id=r.service_id ORDER BY r.updated_at DESC,r.id"),
  ]);
  return { employees, services, rules: rules.map(rule => ({ ...rule, updated_at: rule.updated_at instanceof Date ? rule.updated_at.toISOString() : rule.updated_at })) };
}
