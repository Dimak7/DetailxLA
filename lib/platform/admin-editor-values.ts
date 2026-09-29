export const compensationModels = [
  { value: "commission", label: "Percentage per job" },
  { value: "flat_job", label: "Flat amount per job" },
  { value: "hourly", label: "Hourly" },
  { value: "hourly_commission", label: "Hourly + percentage" },
];

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const rate = (value: unknown) => Number(value ?? 0);

/** Values shown by the browser editor, before its money/basis-point conversion. */
export function compensationEditorValues(employee: Record<string, unknown>) {
  return {
    employee_id: String(employee.id),
    compensation_model: String(employee.compensation_model),
    hourly_rate_cents: rate(employee.hourly_rate_cents) / 100,
    default_commission_bps: rate(employee.default_commission_bps) / 100,
    flat_job_pay_cents: rate(employee.flat_job_pay_cents) / 100,
  };
}

/** Retain inactive model rates so changing the model never silently erases saved values. */
export function compensationEditorPayload(values: Record<string, unknown>) {
  return {
    employee_id: String(values.employee_id),
    compensation_model: String(values.compensation_model),
    hourly_rate_cents: Math.round(rate(values.hourly_rate_cents) * 100),
    default_commission_bps: Math.round(rate(values.default_commission_bps) * 100),
    flat_job_pay_cents: Math.round(rate(values.flat_job_pay_cents) * 100),
  };
}

/** A saved default plan; service rules and job-level overrides are shown separately. */
export function compensationPlanLabel(employee: Record<string, unknown>) {
  const hourly = `${dollars.format(rate(employee.hourly_rate_cents) / 100)}/hr`;
  const percentage = `${rate(employee.default_commission_bps) / 100}% per job`;
  switch (employee.compensation_model) {
    case "commission": return percentage;
    case "flat_job": return `${dollars.format(rate(employee.flat_job_pay_cents) / 100)} per job`;
    case "hourly": return hourly;
    case "hourly_commission": return `${hourly} + ${percentage}`;
    default: return "Pay plan not set";
  }
}

/** Illustrative $200 job at 100% allocation, without tips or service overrides. */
export function compensationSample(values: Record<string, unknown>) {
  const plan = compensationEditorPayload(values);
  return {
    hourlyCents: ["hourly", "hourly_commission"].includes(plan.compensation_model) ? plan.hourly_rate_cents : null,
    jobCents: plan.compensation_model === "flat_job" ? plan.flat_job_pay_cents
      : ["commission", "hourly_commission"].includes(plan.compensation_model) ? Math.round(20_000 * plan.default_commission_bps / 10_000)
        : 0,
  };
}

/** datetime-local uses the browser's timezone, including the selected date's DST offset. */
export function dateTimeLocalValue(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString().slice(0, 16);
}
