/** Values shown by the browser editor, before its money/basis-point conversion. */
export function compensationEditorValues(employee: Record<string, unknown>) {
  return {
    employee_id: String(employee.id),
    compensation_model: String(employee.compensation_model),
    default_commission_bps: Number(employee.default_commission_bps) / 100,
    flat_job_pay_cents: Number(employee.flat_job_pay_cents) / 100,
  };
}

/** datetime-local uses the browser's timezone, including the selected date's DST offset. */
export function dateTimeLocalValue(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString().slice(0, 16);
}
