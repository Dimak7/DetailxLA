import test from "node:test";
import assert from "node:assert/strict";
import { compensationEditorValues, dateTimeLocalValue } from "../lib/platform/admin-editor-values";

test("switching compensation records preserves each employee's saved pay model and precision", () => {
  const employees = [
    { id: "first", compensation_model: "hourly_commission", default_commission_bps: 1234, flat_job_pay_cents: 4506 },
    { id: "second", compensation_model: "flat_job", default_commission_bps: 0, flat_job_pay_cents: 9876 },
  ];
  let values = compensationEditorValues(employees[0]);
  assert.equal(values.default_commission_bps, 12.34);
  assert.equal(values.flat_job_pay_cents, 45.06);
  for (const employee of [employees[1], employees[0]]) {
    values = { ...values, ...compensationEditorValues(employee) };
    assert.deepEqual({
      id: values.employee_id,
      compensation_model: values.compensation_model,
      default_commission_bps: Math.round(values.default_commission_bps * 100),
      flat_job_pay_cents: Math.round(values.flat_job_pay_cents * 100),
    }, employee);
  }
});

test("campaign local-time edits round-trip winter and summer instants without a DST hour shift", () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = "America/Chicago";
  try {
    for (const [instant, expected] of [
      ["2026-01-15T15:30:00.000Z", "2026-01-15T09:30"],
      ["2026-07-15T14:30:00.000Z", "2026-07-15T09:30"],
      ["2026-03-08T07:30:00.000Z", "2026-03-08T01:30"],
      ["2026-03-08T08:30:00.000Z", "2026-03-08T03:30"],
    ]) {
      const value = dateTimeLocalValue(instant);
      assert.equal(value, expected);
      assert.equal(new Date(value).toISOString(), instant);
    }
    assert.equal(dateTimeLocalValue(""), "");
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});
