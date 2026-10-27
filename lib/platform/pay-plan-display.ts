/** Client-safe descriptions of the saved plan; job-specific overrides still take precedence. */
export type PaySettingsEmployee = {
  id: string; name: string; position: string; active: boolean;
  hourly_rate_cents: number; compensation_model: string;
  default_commission_bps: number; flat_job_pay_cents: number;
};
export type PaySettingsService = { id: string; name: string; active: boolean; sort_order: number };
export type PaySettingsRule = {
  id: string; employee_id: string; employee_name: string; service_id: string | null; service_name: string | null;
  rule_type: "commission_percent" | "flat_job"; value: number; active: boolean; updated_at: string;
};
export type EmployeePaySettingsData = { employees: PaySettingsEmployee[]; services: PaySettingsService[]; rules: PaySettingsRule[] };
export type EffectivePayRate = {
  mode: "percentage" | "flat" | "none";
  value: number;
  label: string;
  description: string;
  source: "base" | "all_services" | "service";
  source_label: string;
  rule: PaySettingsRule | null;
  /** A single $200 service with full employee allocation, excluding hourly pay and tips. */
  example_cents: number;
};

const dollars = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: Number(cents) % 100 ? 2 : 0 }).format(Number(cents) / 100);
const stamp = (value: string) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;

/** Match payroll's active/newest/id ordering; stale duplicate rows cannot win. */
export function activePayRules(employeeId: string, rules: PaySettingsRule[]): PaySettingsRule[] {
  const ordered = rules.filter(rule => rule.employee_id === employeeId && rule.active === true)
    .sort((a, b) => stamp(b.updated_at) - stamp(a.updated_at) || a.id.localeCompare(b.id));
  const services = new Set<string | null>();
  return ordered.filter(rule => {
    if (services.has(rule.service_id)) return false;
    services.add(rule.service_id);
    return true;
  });
}

export function effectivePayRate(employee: PaySettingsEmployee, rules: PaySettingsRule[], serviceId?: string | null): EffectivePayRate {
  const active = activePayRules(employee.id, rules);
  const specific = serviceId ? active.find(rule => rule.service_id === serviceId) : undefined;
  const general = active.find(rule => rule.service_id === null);
  const rule = specific || general || null;
  const source = specific ? "service" : general ? "all_services" : "base";
  const mode = rule ? rule.rule_type === "commission_percent" ? "percentage" : "flat"
    : employee.compensation_model === "flat_job" ? "flat"
      : ["commission", "hourly_commission"].includes(employee.compensation_model) ? "percentage" : "none";
  const value = Number(rule?.value ?? (mode === "percentage" ? employee.default_commission_bps : mode === "flat" ? employee.flat_job_pay_cents : 0));
  const label = mode === "percentage" ? `${value / 100}%` : mode === "flat" ? `${dollars(value)} flat` : "No job commission";
  const description = mode === "percentage" ? "Of the service price after discounts."
    : mode === "flat" && source === "service" ? "One flat amount for this service in a job, shared across its service and upgrade lines."
      : mode === "flat" ? "One flat amount per job, shared across services without their own rate."
        : "Hourly pay is tracked separately; no extra job commission applies.";
  return {
    mode, value, label, description, source,
    source_label: source === "service" ? "Custom service rate" : source === "all_services" ? "All-services rule" : "Base rate",
    rule, example_cents: mode === "percentage" ? Math.trunc(20_000 * value / 10_000) : mode === "flat" ? value : 0,
  };
}

export function summarizePayPlan(employee: PaySettingsEmployee, rules: PaySettingsRule[], services: PaySettingsService[]) {
  const active = activePayRules(employee.id, rules);
  const base = effectivePayRate(employee, rules);
  const overrides = active.filter(rule => rule.service_id !== null);
  const hourly = ["hourly", "hourly_commission"].includes(employee.compensation_model) ? Number(employee.hourly_rate_cents) : null;
  return {
    base,
    hourly_cents: hourly,
    hourly_label: hourly === null ? null : `${dollars(hourly)}/hr`,
    default_description: base.source === "all_services"
      ? `${base.label} for services without a custom rate. The all-services rule replaces the base job rate.`
      : `${base.label}${overrides.length ? " for other services" : " for services without a custom rate"}.`,
    service_rates: services.filter(service => service.active || rules.some(rule => rule.employee_id === employee.id && rule.service_id === service.id))
      .map(service => ({ service, rate: effectivePayRate(employee, rules, service.id) })),
    overrides,
  };
}
