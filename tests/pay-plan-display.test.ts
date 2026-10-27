import assert from "node:assert/strict";
import test from "node:test";
import { activePayRules, effectivePayRate, summarizePayPlan, type PaySettingsEmployee, type PaySettingsRule } from "../lib/platform/pay-plan-display";
import { calculateJobCompensation } from "../lib/platform/job-pay-calculation";

const employee: PaySettingsEmployee = { id: "worker", name: "Matthew", position: "Detailer", active: true, hourly_rate_cents: 1200, compensation_model: "commission", default_commission_bps: 4000, flat_job_pay_cents: 8000 };
const services = [{ id: "detail", name: "Full detail", active: true, sort_order: 0 }, { id: "coating", name: "Ceramic coating", active: true, sort_order: 1 }, { id: "correction", name: "Paint correction", active: true, sort_order: 2 }];
function rule(id: string, service_id: string | null, value: number, extra: Partial<PaySettingsRule> = {}): PaySettingsRule {
  return { id, employee_id: employee.id, employee_name: employee.name, service_id, service_name: service_id, rule_type: "commission_percent", value, active: true, updated_at: "2026-10-26T12:00:00Z", ...extra };
}

test("the default percentage is shown together with every service exception", () => {
  const rules = [rule("ceramic", "coating", 2000), rule("paint", "correction", 2000)];
  const plan = summarizePayPlan(employee, rules, services);
  assert.equal(plan.base.label, "40%");
  assert.equal(plan.default_description, "40% for other services.");
  assert.deepEqual(plan.service_rates.map(item => [item.service.name, item.rate.label, item.rate.source]), [["Full detail", "40%", "base"], ["Ceramic coating", "20%", "service"], ["Paint correction", "20%", "service"]]);
  assert.equal(plan.overrides.length, 2);
});

test("specific rules beat all-services rules, newest active rules win and employee rules stay isolated", () => {
  const rules = [rule("old", "coating", 1000, { updated_at: "2026-10-25T12:00:00Z" }), rule("inactive", "coating", 9000, { active: false, updated_at: "2026-10-27T12:00:00Z" }), rule("new", "coating", 2000), rule("all", null, 3000), rule("someone-else", "detail", 9900, { employee_id: "other" })];
  const plan = summarizePayPlan(employee, rules, services);
  assert.equal(plan.base.label, "30%");
  assert.equal(plan.base.source, "all_services");
  assert.match(plan.default_description, /replaces the base job rate/);
  assert.deepEqual(plan.service_rates.map(item => item.rate.label), ["30%", "20%", "30%"]);
  assert.equal(plan.overrides[0].id, "new");
  assert.equal(activePayRules(employee.id, rules).length, 2);
  const tie = [rule("b", "coating", 2000), rule("a", "coating", 1000)];
  assert.equal(effectivePayRate(employee, tie, "coating").rule?.id, "a");
});

test("flat and zero rates retain their meaning, while hourly pay stays separate", () => {
  const hourly = { ...employee, compensation_model: "hourly_commission" };
  const rules = [rule("zero", "coating", 0), rule("flat", "correction", 5550, { rule_type: "flat_job" })];
  const plan = summarizePayPlan(hourly, rules, services);
  assert.equal(plan.hourly_label, "$12/hr");
  assert.equal(plan.service_rates[1].rate.label, "0%");
  assert.equal(plan.service_rates[1].rate.example_cents, 0);
  assert.equal(plan.service_rates[2].rate.label, "$55.50 flat");
  assert.equal(plan.service_rates[2].rate.example_cents, 5550);
  assert.match(plan.service_rates[2].rate.description, /shared across its service and upgrade lines/);
  const flat = effectivePayRate({ ...employee, compensation_model: "flat_job" }, []);
  assert.equal(flat.label, "$80 flat");
  assert.match(flat.description, /One flat amount per job/);
  const hourlyOnly = effectivePayRate({ ...employee, compensation_model: "hourly" }, []);
  assert.equal(hourlyOnly.label, "No job commission");
  assert.equal(hourlyOnly.example_cents, 0);
});

test("displayed example amounts agree with payroll for each effective service rate", () => {
  const rules = [rule("all", null, 3000), rule("coating", "coating", 2000), rule("correction", "correction", 5550, { rule_type: "flat_job" })];
  for (const service of services) {
    const display = effectivePayRate(employee, rules, service.id);
    const pay = calculateJobCompensation({ service_id: service.id, price_cents: 20000, tip_cents: 0, line_items: [{ id: "line", service_id: service.id, name: service.name, quantity: 1, unit_price_cents: 20000 }], assignments: [{ employee_id: employee.id, pool_share_bps: 10000 }], employees: [employee], service_rules: activePayRules(employee.id, rules) });
    assert.equal(display.example_cents, pay[0].commission_cents);
  }
});

test("inactive services with this employee's history remain available without showing other employees' retired services", () => {
  const catalog = [...services, { id: "retired", name: "Old service", active: false, sort_order: 3 }, { id: "other-old", name: "Other retired service", active: false, sort_order: 4 }];
  const rules = [rule("inactive", "retired", 2000, { active: false }), rule("other", "other-old", 2000, { employee_id: "other" })];
  const plan = summarizePayPlan(employee, rules, catalog);
  assert.equal(plan.service_rates.length, 4);
  assert.equal(plan.service_rates[3].rate.source, "base");
  assert.equal(plan.overrides.length, 0);
});
