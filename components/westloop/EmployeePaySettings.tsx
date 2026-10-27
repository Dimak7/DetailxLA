"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, action, type RecordData } from "./AdminControls";
import { compensationEditorPayload, compensationEditorValues, compensationModels } from "@/lib/platform/admin-editor-values";
import { effectivePayRate, summarizePayPlan, type EmployeePaySettingsData, type PaySettingsEmployee, type PaySettingsRule } from "@/lib/platform/pay-plan-display";
import { money } from "@/lib/platform/types";
import styles from "./EmployeePaySettings.module.css";

export function PayPlanSummary({ employee, rules }: { employee: RecordData; rules: RecordData[] }) {
  const plan = summarizePayPlan(employee as unknown as PaySettingsEmployee, rules as unknown as PaySettingsRule[], []);
  return <div className={styles.compact}>
    {plan.hourly_label && <span>{plan.hourly_label} hourly</span>}
    <span><strong>{plan.base.label}</strong> {plan.overrides.length ? "other services" : "standard job pay"}</span>
    {plan.base.source === "all_services" && <small>All-services rule replaces base job pay</small>}
    {plan.overrides.map(rule => <span className={styles.compactRule} key={rule.id}>{rule.service_name || "Service rate"}<strong>{rule.rule_type === "commission_percent" ? `${rule.value / 100}%` : `${money(rule.value)} flat`}</strong></span>)}
  </div>;
}

type RuleEdit = { serviceId: string | null; name: string; rule: PaySettingsRule | null };
async function loadSettings(signal?: AbortSignal): Promise<EmployeePaySettingsData> {
  const response = await fetch("/api/admin/employee-pay-settings", { cache: "no-store", signal });
  const result = await response.json();
  if (!response.ok || result.ok === false) throw new Error(result.error || "Could not load pay settings.");
  return result;
}

export function EmployeePaySettings({ employeeId, onClose }: { employeeId?: string; onClose: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<EmployeePaySettingsData | null>(null);
  const [selected, setSelected] = useState(employeeId || "");
  const [baseEditing, setBaseEditing] = useState(false);
  const [ruleEditing, setRuleEditing] = useState<RuleEdit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void loadSettings(controller.signal).then(result => { if (!controller.signal.aborted) { setData(result); setSelected(current => result.employees.some(employee => employee.id === current) ? current : result.employees[0]?.id || ""); } }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load pay settings."); });
    return () => controller.abort();
  }, [retry]);
  const employee = data?.employees.find(item => item.id === selected);
  const plan = employee && data ? summarizePayPlan(employee, data.rules, data.services) : null;
  const inactive = data?.rules.filter(rule => rule.employee_id === selected && !rule.active) || [];
  async function save(name: string, values: RecordData) {
    setBusy(true); setError(""); setNotice("");
    try {
      await action(name, values);
      const fresh = await loadSettings();
      setData(fresh); setBaseEditing(false); setRuleEditing(null);
      setNotice("Pay settings saved. The rates below show what applies now.");
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save pay settings."); }
    finally { setBusy(false); }
  }
  function editRule(serviceId: string | null, name: string, rule: PaySettingsRule | null) { setBaseEditing(false); setRuleEditing({ serviceId, name, rule }); setNotice(""); }
  return <Modal title="Employee pay settings" onClose={onClose} wide><div className={styles.settings}>
    {error && <div className="error-message" role="alert">{error} {!data && <button onClick={() => setRetry(value => value + 1)}>Try again</button>}</div>}
    {notice && <p className="success-message" role="status">{notice}</p>}
    {!data ? <p role="status">Loading the complete pay plan…</p> : !employee || !plan ? <p>Add an employee to set up their pay.</p> : <>
      <div className={styles.intro}><label>Employee<select value={selected} disabled={busy || baseEditing || !!ruleEditing} onChange={event => { setSelected(event.target.value); setNotice(""); setError(""); }}>{data.employees.map(item => <option key={item.id} value={item.id}>{item.name}{!item.active ? " · inactive" : ""}</option>)}</select></label><p>All of {employee.name}’s rates in one place. A custom service rate replaces the standard job rate for that service.</p></div>
      <div className={styles.standard}>
        <div><span className={styles.kicker}>{plan.overrides.length ? "Other services" : "Standard job rate"}</span><strong className={styles.bigRate}>{plan.base.label}</strong><p>{plan.overrides.length ? "These services have different rates:" : "Applies when a service has no custom rate."}</p>{plan.hourly_label && <p><strong>Plus {plan.hourly_label}</strong> for paid hours</p>}</div>
        {plan.overrides.length > 0 && <div className={styles.customSummary}>{plan.overrides.map(rule => <div key={rule.id}><span>{rule.service_name || "Custom service"}</span><strong>{rule.rule_type === "commission_percent" ? `${rule.value / 100}%` : `${money(rule.value)} flat`}</strong></div>)}</div>}
        <button disabled={busy || !!ruleEditing} onClick={() => { setBaseEditing(value => !value); setNotice(""); }}>{baseEditing ? "Cancel edit" : "Edit base pay"}</button>
      </div>
      {plan.base.source === "all_services" && <div className={styles.callout}><div><strong>An all-services rule is active: {plan.base.label}</strong><p>It replaces the employee’s base job rate. Specific service rates below still take priority. Hourly pay is separate.</p></div><button disabled={busy || baseEditing} onClick={() => editRule(null, "All-services rate", plan.base.rule)}>Edit this rule</button></div>}
      {baseEditing && <BasePayEditor key={employee.id} employee={employee} busy={busy} hasGeneralRule={plan.base.source === "all_services"} onSave={values => save("save_employee_compensation", values)} onCancel={() => setBaseEditing(false)} />}
      {ruleEditing?.serviceId === null && <ServiceRateEditor key={`general-${ruleEditing.rule?.id || "new"}`} edit={ruleEditing} employee={employee} rules={data.rules} busy={busy} onSave={save} onCancel={() => setRuleEditing(null)} />}
      <section className={styles.serviceSection} aria-label="Rates for every service">
        <div className={styles.sectionHeading}><div><h3>What each service pays</h3><p>These are the actual saved rates, including every exception.</p></div><span>{plan.overrides.length} custom {plan.overrides.length === 1 ? "rate" : "rates"}</span></div>
        <div className={styles.columnLabels} aria-hidden="true"><span>Service</span><span>Rate applied</span><span>On a $200 service</span><span /></div>
        <div className={styles.serviceList}>{[...plan.service_rates].sort((a, b) => Number(b.rate.source === "service") - Number(a.rate.source === "service")).map(({ service, rate }) => <div className={`${styles.serviceRow} ${rate.source === "service" ? styles.custom : ""}`} key={service.id}>
          <div className={styles.serviceName}><strong>{service.name}</strong>{!service.active && <small>Inactive service</small>}</div>
          <div className={styles.rate}><strong>{rate.label}</strong><span>{rate.source === "service" ? "Custom service rate" : rate.source === "all_services" ? "All-services rate" : "Uses standard rate"}</span></div>
          <div className={styles.example}><span className={styles.mobileLabel}>On a $200 service</span><strong>{money(rate.example_cents)}</strong><span>job pay</span></div>
          <button disabled={busy || baseEditing || (!!ruleEditing && ruleEditing.serviceId !== service.id)} aria-label={`Change rate for ${service.name}`} onClick={() => editRule(service.id, service.name, rate.source === "service" ? rate.rule : null)}>Change rate</button>
          {ruleEditing?.serviceId === service.id && <div className={styles.inlineEditor}><ServiceRateEditor key={`${service.id}-${ruleEditing.rule?.id || "new"}`} edit={ruleEditing} employee={employee} rules={data.rules} busy={busy} onSave={save} onCancel={() => setRuleEditing(null)} /></div>}
        </div>)}</div>
        <p className={styles.note}>Examples use one $200 service after discounts and one worker. A flat job amount is shared across services, not added for every row. Hourly pay and tips are separate.</p>
      </section>
      <div className={styles.explainer}><strong>A different rate for one particular job?</strong><p>Set it in Bookings → Open job → Team &amp; pay. Job and upgrade-specific rates take priority over this saved plan. Work history shows the calculation actually used.</p></div>
      {inactive.length > 0 && <details className={styles.history}><summary>Inactive rate history ({inactive.length})</summary><p>These rates do not affect pay. To use a rate again, change its service above.</p>{inactive.map(rule => <div key={rule.id}><span>{rule.service_name || "All services"}</span><strong>{rule.rule_type === "commission_percent" ? `${rule.value / 100}%` : `${money(rule.value)} flat`}</strong><span>Inactive</span></div>)}</details>}
    </>}
  </div></Modal>;
}

function PreserveCompleted({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return <label className={styles.check}><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /><span>Keep completed-job earnings unchanged<small>{checked ? "Completed-job commission amounts stay saved. Paid payroll stays unchanged." : "Completed-job estimates without a saved amount may be recalculated. Paid payroll stays unchanged."}</small></span></label>;
}

function BasePayEditor({ employee, busy, hasGeneralRule, onSave, onCancel }: { employee: PaySettingsEmployee; busy: boolean; hasGeneralRule: boolean; onSave: (values: RecordData) => Promise<void>; onCancel: () => void }) {
  const [values, setValues] = useState(() => { const initial = compensationEditorValues(employee); return { ...initial, hourly_rate_cents: String(initial.hourly_rate_cents), default_commission_bps: String(initial.default_commission_bps), flat_job_pay_cents: String(initial.flat_job_pay_cents) }; });
  const [preserve, setPreserve] = useState(true);
  return <form className={styles.editor} onSubmit={event => { event.preventDefault(); void onSave({ ...compensationEditorPayload(values), preserve_completed: preserve }); }}>
    <h4>Edit base pay</h4><p>Custom service rates stay in place when you change the base plan.</p>
    {hasGeneralRule && <p className={styles.warning}>The all-services rule currently replaces this base job rate. Edit that rule to change the standard rate shown above.</p>}
    <div className={styles.fields}><label>Pay structure<select value={values.compensation_model} onChange={event => setValues({ ...values, compensation_model: event.target.value })}>{compensationModels.map(model => <option key={model.value} value={model.value}>{model.label}</option>)}</select></label>
      {["commission", "hourly_commission"].includes(values.compensation_model) && <label>Standard commission (%)<input type="number" min="0" max="100" step="0.01" required value={values.default_commission_bps} onChange={event => setValues({ ...values, default_commission_bps: event.target.value })} /></label>}
      {values.compensation_model === "flat_job" && <label>Flat amount per job ($)<input type="number" min="0" max="1000000" step="0.01" required value={values.flat_job_pay_cents} onChange={event => setValues({ ...values, flat_job_pay_cents: event.target.value })} /></label>}
      {["hourly", "hourly_commission"].includes(values.compensation_model) && <label>Hourly rate ($)<input type="number" min="0" max="1000000" step="0.01" required value={values.hourly_rate_cents} onChange={event => setValues({ ...values, hourly_rate_cents: event.target.value })} /></label>}
    </div>{["hourly", "hourly_commission"].includes(values.compensation_model) && <p>Hourly-rate changes can affect unpaid hourly-pay estimates.</p>}<PreserveCompleted checked={preserve} onChange={setPreserve} /><div className={styles.actions}><button type="submit" className="button" disabled={busy}>{busy ? "Saving…" : "Save base pay"}</button><button type="button" disabled={busy} onClick={onCancel}>Cancel</button></div>
  </form>;
}

function ServiceRateEditor({ edit, employee, rules, busy, onSave, onCancel }: { edit: RuleEdit; employee: PaySettingsEmployee; rules: PaySettingsRule[]; busy: boolean; onSave: (action: string, values: RecordData) => Promise<void>; onCancel: () => void }) {
  const fallback = effectivePayRate(employee, rules.filter(rule => rule.service_id !== edit.serviceId));
  const [mode, setMode] = useState(edit.rule?.rule_type || (fallback.mode === "flat" ? "flat_job" : "commission_percent"));
  const [value, setValue] = useState(String((edit.rule?.value ?? fallback.value) / 100));
  const [preserve, setPreserve] = useState(true);
  const [removing, setRemoving] = useState(false);
  return <form className={styles.editor} onSubmit={event => { event.preventDefault(); void onSave("save_pay_rule", { ...(edit.rule?.rule_type === mode ? { id: edit.rule.id } : {}), employee_id: employee.id, service_id: edit.serviceId, rule_type: mode, value: Math.round(Number(value) * 100), active: true, preserve_completed: preserve }); }}>
    <h4>{edit.name}</h4><p>{edit.serviceId === null ? "Applies to services without their own custom rate." : "Replaces the standard job rate for this service. Hourly pay and tips remain separate."}</p>
    <div className={styles.fields}><label>Pay method<select value={mode} onChange={event => { setMode(event.target.value as typeof mode); setRemoving(false); }}><option value="commission_percent">Percentage of service price</option><option value="flat_job">{edit.serviceId === null ? "Flat amount per job" : "Flat amount for this service"}</option></select></label><label>{mode === "commission_percent" ? "Service commission (%)" : "Flat amount ($)"}<input type="number" min="0" max={mode === "commission_percent" ? "100" : "1000000"} step="0.01" required value={value} onChange={event => setValue(event.target.value)} /></label></div>
    <PreserveCompleted checked={preserve} onChange={setPreserve} />
    <div className={styles.actions}><button className="button" disabled={busy || removing} type="submit">{busy ? "Saving…" : "Save service rate"}</button><button type="button" disabled={busy} onClick={onCancel}>Cancel</button>{edit.rule && <button type="button" disabled={busy} onClick={() => setRemoving(true)}>Remove custom rate</button>}</div>
    {removing && edit.rule && <div className={styles.removal}><p>Remove this custom rate? {edit.serviceId === null ? "Services without a custom rate" : "This service"} will use <strong>{fallback.label}</strong> instead.</p><div className={styles.actions}><button type="button" disabled={busy} onClick={() => void onSave("remove_pay_rule", { id: edit.rule!.id, preserve_completed: preserve })}>Confirm removal</button><button type="button" disabled={busy} onClick={() => setRemoving(false)}>Keep rate</button></div></div>}
  </form>;
}
