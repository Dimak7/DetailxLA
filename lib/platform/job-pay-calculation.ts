/** Shared by the job editor and payroll. All monetary values are integer cents. */
export type JobPayType = "default" | "percentage" | "flat";
export type JobLinePayRule = { line_item_id: string; pay_type: "percentage" | "flat"; pay_value: number };
export type JobPayLine = { id: string; service_id?: string | null; name: string; quantity: number; unit_price_cents: number };
export type JobPayAssignment = {
  employee_id: string;
  pool_share_bps: number;
  commission_override_cents?: number | null;
  tip_override_cents?: number | null;
  pay_type?: JobPayType;
  pay_value?: number;
  line_pay_rules?: JobLinePayRule[];
};
export type EmployeePayPlan = {
  id: string;
  compensation_model: string;
  default_commission_bps: number;
  flat_job_pay_cents: number;
};
export type EmployeeServicePayRule = {
  employee_id: string;
  service_id: string | null;
  rule_type: "commission_percent" | "flat_job";
  value: number;
};
export type JobCompensationInput = {
  service_id: string;
  price_cents: number | null;
  paid_cents?: number;
  tip_cents: number;
  tip_recipient_employee_id?: string | null;
  line_items: JobPayLine[];
  assignments: JobPayAssignment[];
  employees: EmployeePayPlan[];
  /** Most recently updated rule first, matching the saved pay-settings precedence. */
  service_rules: EmployeeServicePayRule[];
};
export type JobPayBreakdown = {
  line_item_id: string;
  name: string;
  gross_cents: number;
  net_cents: number;
  pay_cents: number;
  source: "employee_plan" | "service_rule" | "job_rate" | "line_rate" | "saved_amount";
};
export type JobCompensationResult = {
  employee_id: string;
  commission_cents: number;
  tips_cents: number;
  attributed_revenue: number;
  lines: JobPayBreakdown[];
};

const whole = (value: number | undefined | null) => {
  const number = Math.trunc(Number(value));
  return Number.isSafeInteger(number) ? Math.max(0, number) : 0;
};
const multiply = (amount: number, numerator: number, denominator = 10000) =>
  Number(BigInt(whole(amount)) * BigInt(whole(numerator)) / BigInt(denominator));

/** Cumulative allocation keeps every cent, including zero-value and uneven splits. */
export function allocateJobCents(total: number, weights: number[]): number[] {
  const sum = weights.reduce((value, weight) => value + whole(weight), 0);
  let running = 0;
  return weights.map((weight, index) => {
    if (sum === 0) return index === 0 ? whole(total) : 0;
    const previous = running;
    running += whole(weight);
    return multiply(total, running, sum) - multiply(total, previous, sum);
  });
}

export function calculateJobCompensation(input: JobCompensationInput): JobCompensationResult[] {
  // A deposit is only a payment toward the agreed price. It never reduces job pay.
  const total = whole(input.price_cents ?? input.paid_cents);
  const lines = input.line_items.length ? [...input.line_items].sort((a, b) => a.id.localeCompare(b.id)) : [{
    id: "base-service", service_id: input.service_id, name: "Service", quantity: 1, unit_price_cents: total,
  }];
  const gross = lines.map((line) => whole(line.quantity) * whole(line.unit_price_cents));
  const serviceId = (line: JobPayLine) => line.service_id || input.service_id;
  const groups = [...new Set(lines.map(serviceId))].sort().map((id) => ({
    id, indexes: lines.flatMap((line, index) => serviceId(line) === id ? [index] : []),
  }));
  // Allocate to services first to retain legacy service-rule rounding, then to
  // individual lines so an upsell can have its own rate even for the same service.
  const serviceAmounts = allocateJobCents(total, groups.map((group) => group.indexes.reduce((sum, index) => sum + gross[index], 0)));
  const net = lines.map(() => 0);
  groups.forEach((group, groupIndex) => {
    const amounts = allocateJobCents(serviceAmounts[groupIndex], group.indexes.map((index) => gross[index]));
    group.indexes.forEach((index, i) => { net[index] = amounts[i]; });
  });
  const validShares = input.assignments.reduce((sum, assignment) => sum + whole(assignment.pool_share_bps), 0) === 10000;
  const firstEmployee = input.assignments.map((assignment) => assignment.employee_id).sort()[0];
  const hasTipOverrides = input.assignments.some((assignment) => assignment.tip_override_cents != null);
  const tip = whole(input.tip_cents);

  return input.assignments.map((assignment) => {
    const employee = input.employees.find((row) => row.id === assignment.employee_id);
    const pays = lines.map(() => 0);
    const sources: JobPayBreakdown["source"][] = lines.map(() => "employee_plan");
    const setPay = (indexes: number[], cents: number, source: JobPayBreakdown["source"]) => {
      const portions = allocateJobCents(cents, indexes.map((index) => net[index]));
      indexes.forEach((index, i) => { pays[index] = portions[i]; sources[index] = source; });
    };
    if (assignment.commission_override_cents != null) {
      setPay(lines.map((_, index) => index), whole(assignment.commission_override_cents), "saved_amount");
    } else if (employee && validShares) {
      const lineRules = assignment.line_pay_rules || [];
      const remaining = lines.flatMap((line, index) => {
        const rule = lineRules.find((value) => value.line_item_id === line.id);
        if (!rule) return [index];
        pays[index] = rule.pay_type === "flat" ? whole(rule.pay_value) : multiply(net[index], rule.pay_value);
        sources[index] = "line_rate";
        return [];
      });
      const mode = assignment.pay_type || "default";
      if (mode !== "default") {
        // Explicit job and line rates are this employee's direct pay. Applying a
        // second team-share multiplier here would silently underpay the detailer.
        const amount = mode === "flat" ? whole(assignment.pay_value) : multiply(remaining.reduce((sum, index) => sum + net[index], 0), assignment.pay_value || 0);
        if (remaining.length) setPay(remaining, amount, "job_rate");
      } else {
        const rules = input.service_rules.filter((rule) => rule.employee_id === employee.id);
        const general = rules.find((rule) => rule.service_id === null);
        const unruled: number[] = [];
        const pending: { indexes: number[]; units: number; source: JobPayBreakdown["source"] }[] = [];
        for (const group of groups) {
          const indexes = group.indexes.filter((index) => remaining.includes(index));
          if (!indexes.length) continue;
          const rule = rules.find((row) => row.service_id === group.id);
          if (!rule) { unruled.push(...indexes); continue; }
          const value = indexes.reduce((sum, index) => sum + net[index], 0);
          pending.push({ indexes, units: rule.rule_type === "flat_job" ? whole(rule.value) * 10000 : value * whole(rule.value), source: "service_rule" });
        }
        if (unruled.length) {
          const value = unruled.reduce((sum, index) => sum + net[index], 0);
          const flat = general?.rule_type === "flat_job" || (!general && employee.compensation_model === "flat_job");
          const percent = general?.rule_type === "commission_percent" || (!general && ["commission", "hourly_commission"].includes(employee.compensation_model));
          pending.push({ indexes: unruled, units: flat ? whole(general?.value ?? employee.flat_job_pay_cents) * 10000 : percent ? value * whole(general?.value ?? employee.default_commission_bps) : 0, source: "employee_plan" });
        }
        // Preserve the existing one-time job share and cent truncation across all
        // default/service-rule components, rather than truncating each share twice.
        const shared = multiply(pending.reduce((sum, part) => sum + part.units, 0), assignment.pool_share_bps, 100000000);
        const parts = allocateJobCents(shared, pending.map((part) => part.units));
        pending.forEach((part, index) => setPay(part.indexes, parts[index], part.source));
      }
    }
    const tips = input.tip_recipient_employee_id
      ? (input.tip_recipient_employee_id === assignment.employee_id ? tip : 0)
      : hasTipOverrides ? whole(assignment.tip_override_cents)
        : Math.floor(tip / input.assignments.length) + (assignment.employee_id === firstEmployee ? tip % input.assignments.length : 0);
    return {
      employee_id: assignment.employee_id,
      commission_cents: pays.reduce((sum, value) => sum + value, 0),
      tips_cents: tips,
      attributed_revenue: multiply(total, assignment.pool_share_bps),
      lines: lines.map((line, index) => ({ line_item_id: line.id, name: line.name, gross_cents: gross[index], net_cents: net[index], pay_cents: pays[index], source: sources[index] })),
    };
  });
}
