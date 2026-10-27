import test from "node:test";
import assert from "node:assert/strict";
import { payrollCsv } from "../lib/platform/payroll-export";

test("payroll CSV exports the same hours and earnings fields as the dashboard", () => {
  const csv = payrollCsv([{
    name: "Matthew", position: "Detailer",
    scheduled_minutes: 480, actual_minutes: 375, minutes: 375,
    paid_hours_source: "actual_clocked", hourly_earnings_cents: 9375,
    attributed_revenue: 55000, commission_cents: 23500,
    tips_cents: 7500, adjustment_cents: -1234, total_earnings_cents: 39141,
    // The obsolete export fields must not override the displayed calculation.
    regular_minutes: 600, overtime_minutes: 60, estimated_gross_cents: 99999,
  }]);
  const [header, employee] = csv.split("\r\n");
  assert.equal(header, '"Employee","Position","Scheduled hours","Actual hours","Paid hours","Paid hours source","Hourly earnings (USD)","Attributed service revenue (USD)","Job pay (USD)","Tips (USD)","Adjustments (USD)","Total earnings (USD)"');
  assert.equal(employee, '"Matthew","Detailer","8.00","6.25","6.25","Clocked time","93.75","550.00","235.00","75.00","-12.34","391.41"');
});

test("scheduled fallback and string-valued database amounts export without changing the saved total", () => {
  const csv = payrollCsv([{
    name: "Alex", position: "Detailer", scheduled_minutes: "450", actual_minutes: 0, minutes: "450",
    paid_hours_source: "scheduled_fallback", hourly_earnings_cents: "11250",
    attributed_revenue: "50000", commission_cents: "20000", tips_cents: "1000",
    adjustment_cents: "250", total_earnings_cents: "32617",
  }]);
  assert.equal(csv.split("\r\n")[1], '"Alex","Detailer","7.50","0.00","7.50","Scheduled-hours fallback","112.50","500.00","200.00","10.00","2.50","326.17"');
});

test("employee text is formula-safe and retains valid CSV quotes, commas, and newlines", () => {
  for (const prefix of ["=", "+", "-", "@", " \t=", "\r\n+"]) {
    const name = `${prefix}SUM(1,2)`;
    const csv = payrollCsv([{ name, position: 'Lead "detailer", team\nA', adjustment_cents: -500 }]);
    assert.ok(csv.includes(`"'${name}","Lead ""detailer"", team\nA"`), `unsafe text prefix: ${JSON.stringify(prefix)}`);
    assert.ok(csv.endsWith(',"-5.00","0.00"'), "negative adjustments must remain numeric values");
  }
  const roleFormula = payrollCsv([{ name: "Normal name", position: "=HYPERLINK(1)", paid_hours_source: "@SUM(1)" }]);
  assert.ok(roleFormula.includes('"Normal name","\'=HYPERLINK(1)"'));
  assert.ok(roleFormula.includes('"\'@SUM(1)"'));
});

test("an empty payroll period exports the column headings without a fake employee row", () => {
  const csv = payrollCsv([]);
  assert.equal(csv.split("\r\n").length, 1);
  assert.ok(csv.endsWith('"Total earnings (USD)"'));
});
