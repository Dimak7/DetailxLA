import test from "node:test";
import assert from "node:assert/strict";
import { compensationEditorValues, compensationEditorPayload, compensationPlanLabel, compensationSample, dateTimeLocalValue } from "../lib/platform/admin-editor-values";

test("switching compensation records preserves each employee's saved pay model and precision", () => {
  const employees = [
    { id: "first", compensation_model: "hourly_commission", hourly_rate_cents: 1825, default_commission_bps: 1234, flat_job_pay_cents: 4506 },
    { id: "second", compensation_model: "flat_job", hourly_rate_cents: 2210, default_commission_bps: 0, flat_job_pay_cents: 9876 },
  ];
  let values = compensationEditorValues(employees[0]);
  assert.equal(values.default_commission_bps, 12.34);
  assert.equal(values.flat_job_pay_cents, 45.06);
  assert.equal(values.hourly_rate_cents, 18.25);
  for (const employee of [employees[1], employees[0]]) {
    values = { ...values, ...compensationEditorValues(employee) };
    const { employee_id, ...saved } = compensationEditorPayload(values);
    assert.deepEqual({ id: employee_id, ...saved }, employee);
  }
});

test("changing pay models preserves inactive rates and converts decimal browser values exactly", () => {
  const values = { employee_id: "employee", compensation_model: "commission", hourly_rate_cents: "19.99", default_commission_bps: "12.34", flat_job_pay_cents: "34.56" };
  for (const model of ["commission", "flat_job", "hourly", "hourly_commission"]) {
    assert.deepEqual(compensationEditorPayload({ ...values, compensation_model: model }), {
      employee_id: "employee", compensation_model: model, hourly_rate_cents: 1999, default_commission_bps: 1234, flat_job_pay_cents: 3456,
    });
  }
});

test("saved plan labels and the illustrative job distinguish hourly, flat and percentage pay", () => {
  const saved = { id: "employee", hourly_rate_cents: 1850, default_commission_bps: 1234, flat_job_pay_cents: 3456 };
  for (const [model, label, sample] of [
    ["commission", "12.34% per job", { hourlyCents: null, jobCents: 2468 }],
    ["flat_job", "$34.56 per job", { hourlyCents: null, jobCents: 3456 }],
    ["hourly", "$18.50/hr", { hourlyCents: 1850, jobCents: 0 }],
    ["hourly_commission", "$18.50/hr + 12.34% per job", { hourlyCents: 1850, jobCents: 2468 }],
  ] as const) {
    const employee = { ...saved, compensation_model: model };
    assert.equal(compensationPlanLabel(employee), label);
    assert.deepEqual(compensationSample(compensationEditorValues(employee)), sample);
  }
  assert.equal(compensationPlanLabel({}), "Pay plan not set");
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
