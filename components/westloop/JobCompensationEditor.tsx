"use client";

import { useState } from "react";
import { action, type RecordData } from "./AdminControls";
import { money } from "@/lib/platform/types";
import { calculateJobCompensation, type JobLinePayRule, type JobPayType } from "@/lib/platform/job-pay-calculation";
import styles from "./JobCompensationEditor.module.css";

type LineDraft = { line_item_id: string; pay_type: "percentage" | "flat"; value: string };
type Draft = { employee_id: string; share: string; pay_type: JobPayType; value: string; line_rules: LineDraft[]; notes: string };
const array = (value: unknown): RecordData[] => Array.isArray(value) ? value as RecordData[] : [];
const number = (value: unknown) => Number(value || 0);
const text = (value: unknown) => String(value || "");
const units = (value: string) => Math.round(Number(value || 0) * 100);
const employeeId = (employee: RecordData) => text(employee.employee_id || employee.id);
const ordered = (rules: JobLinePayRule[]) => JSON.stringify([...rules].sort((a, b) => a.line_item_id.localeCompare(b.line_item_id)));

export function JobCompensationEditor({ booking, employees, rules = [], onSaved }: {
  booking: RecordData; employees: RecordData[]; rules?: RecordData[]; onSaved: () => void;
}) {
  const original = array(booking.job_assignments);
  const initial: RecordData[] = original.length ? original : employees.filter((employee) => employee.user_id === booking.assigned_to).slice(0, 1).map((employee) => ({ employee_id: employeeId(employee), pool_share_bps: 10000 }));
  const [drafts, setDrafts] = useState<Draft[]>(() => initial.map((row) => ({
    employee_id: text(row.employee_id), share: String(number(row.pool_share_bps) / 100),
    pay_type: (row.pay_type || "default") as JobPayType, value: String(number(row.pay_value) / 100),
    line_rules: array(row.line_pay_rules).map((rule) => ({ line_item_id: text(rule.line_item_id), pay_type: rule.pay_type as "percentage" | "flat", value: String(number(rule.pay_value) / 100) })),
    notes: text(row.notes),
  })));
  const [tipRecipient, setTipRecipient] = useState(text(booking.tip_recipient_employee_id) || (initial.length === 1 ? text(initial[0].employee_id) : ""));
  const [assignmentOverride, setAssignmentOverride] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lines = array(booking.line_items);
  const name = (id: string) => text(employees.find((employee) => employeeId(employee) === id)?.name || original.find((row) => row.employee_id === id)?.name) || "Detailer";
  const available = employees.filter((employee) => !drafts.some((draft) => draft.employee_id === employeeId(employee)));
  const recipient = drafts.length === 0 ? "" : drafts.length === 1 ? drafts[0].employee_id : tipRecipient;
  const assignments = drafts.map((draft) => {
    const previous = original.find((row) => row.employee_id === draft.employee_id);
    const lineRules: JobLinePayRule[] = draft.line_rules.map((rule) => ({ line_item_id: rule.line_item_id, pay_type: rule.pay_type, pay_value: units(rule.value) }));
    const same = previous && number(previous.pool_share_bps) === units(draft.share)
      && (previous.pay_type || "default") === draft.pay_type && number(previous.pay_value) === units(draft.value)
      && ordered(array(previous.line_pay_rules) as JobLinePayRule[]) === ordered(lineRules);
    return { employee_id: draft.employee_id, pool_share_bps: units(draft.share), pay_type: draft.pay_type, pay_value: units(draft.value),
      line_pay_rules: lineRules, commission_override_cents: same && previous.commission_override_cents != null ? number(previous.commission_override_cents) : null,
      tip_override_cents: previous?.tip_override_cents == null ? null : number(previous.tip_override_cents) };
  });
  const validAmount = (value: string, maximum: number) => /^\d+(\.\d{1,2})?$/.test(value) && Number(value) <= maximum;
  const validAmounts = drafts.every((draft) => validAmount(draft.share, 100) && validAmount(draft.value, draft.pay_type === "percentage" ? 100 : 1000000)
    && draft.line_rules.every((rule) => validAmount(rule.value, rule.pay_type === "percentage" ? 100 : 1000000)));
  const preview = calculateJobCompensation({
    service_id: text(booking.service_id), price_cents: booking.price_cents == null ? null : number(booking.price_cents),
    tip_cents: number(booking.tip_cents), tip_recipient_employee_id: recipient || null,
    line_items: lines.map((line) => ({ id: text(line.id), service_id: text(line.service_id) || null, name: text(line.name), quantity: number(line.quantity), unit_price_cents: number(line.unit_price_cents) })),
    assignments, employees: employees.map((employee) => ({ id: employeeId(employee), compensation_model: text(employee.compensation_model), default_commission_bps: number(employee.default_commission_bps), flat_job_pay_cents: number(employee.flat_job_pay_cents) })),
    service_rules: rules.filter((rule) => rule.active !== false).map((rule) => ({ employee_id: text(rule.employee_id), service_id: text(rule.service_id) || null, rule_type: rule.rule_type as "commission_percent" | "flat_job", value: number(rule.value) })),
  });
  function update(id: string, values: Partial<Draft>) { setDrafts((current) => current.map((draft) => draft.employee_id === id ? { ...draft, ...values } : draft)); }
  function resize(next: Draft[]) {
    setDrafts(next.map((draft, index) => ({ ...draft, share: String((Math.floor(10000 / next.length) + (index < 10000 % next.length ? 1 : 0)) / 100) })));
    if (next.length === 1) setTipRecipient(next[0].employee_id);
    else if (!next.some((draft) => draft.employee_id === tipRecipient)) setTipRecipient("");
  }
  function lineRate(draft: Draft, id: string, mode: string) {
    const current = draft.line_rules.find((rule) => rule.line_item_id === id);
    update(draft.employee_id, { line_rules: [...draft.line_rules.filter((rule) => rule.line_item_id !== id), ...(mode === "default" ? [] : [{ line_item_id: id, pay_type: mode as "percentage" | "flat", value: current?.value || "0" }])] });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!validAmounts) { setError("Use amounts of zero or more with no more than two decimal places. Percentages cannot exceed 100%."); return; }
    if (drafts.length && assignments.reduce((sum, row) => sum + row.pool_share_bps, 0) !== 10000) { setError("Default-plan shares must total 100%. Open Default-plan split to adjust them."); return; }
    if (drafts.length > 1 && !recipient) { setError("Choose the detailer who receives the full tip."); return; }
    setBusy(true);
    try {
      await action("save_job_compensation", { booking_id: booking.id, assignment_override: assignmentOverride, tip_recipient_employee_id: recipient || null, assignments: drafts.map((draft, index) => ({
        employee_id: draft.employee_id, pool_share_bps: assignments[index].pool_share_bps, pay_type: draft.pay_type,
        pay_value: assignments[index].pay_value, line_rules: assignments[index].line_pay_rules, notes: draft.notes,
      })) });
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save detailer pay."); }
    finally { setBusy(false); }
  }
  return <form className={styles.editor} onSubmit={save}>
    <div className={styles.intro}><h3>Detailers & job pay</h3><p>Commission uses the full service price after discounts. Deposits do not reduce earnings. Tips go entirely to the detailer you select.</p></div>
    <label className="field"><span>Add a detailer</span><select value="" disabled={busy || !available.length} onChange={(event) => { if (event.target.value) resize([...drafts, { employee_id: event.target.value, share: "100", pay_type: "default", value: "0", line_rules: [], notes: "" }]); }}>
      <option value="">{available.length ? "Choose a team member" : "All available detailers assigned"}</option>
      {available.map((employee) => <option key={employeeId(employee)} value={employeeId(employee)}>{text(employee.name)}</option>)}
    </select></label>
    {!drafts.length && <p className="small-note">No detailer assigned. Add the worker who is doing this job.</p>}
    {drafts.map((draft, index) => {
      const earned = preview[index], employee = employees.find((row) => employeeId(row) === draft.employee_id);
      return <section className={styles.card} key={draft.employee_id} aria-label={`${name(draft.employee_id)} job pay`}>
        <div className={styles.cardHeader}><h4>{name(draft.employee_id)}</h4><button type="button" disabled={busy} onClick={() => resize(drafts.filter((row) => row.employee_id !== draft.employee_id))}>Remove detailer</button></div>
        <div className={styles.rateGrid}>
          <label className="field"><span>Job pay</span><select value={draft.pay_type} disabled={busy} onChange={(event) => update(draft.employee_id, { pay_type: event.target.value as JobPayType, value: "0" })}>
            <option value="default">Employee's saved pay plan</option><option value="percentage">Percentage of service price</option><option value="flat">Flat amount for this job</option>
          </select></label>
          {draft.pay_type !== "default" && <label className="field"><span>{draft.pay_type === "percentage" ? "Job commission (%)" : "Flat job pay ($)"}</span><input type="number" inputMode="decimal" min="0" max={draft.pay_type === "percentage" ? 100 : 1000000} step="0.01" value={draft.value} required disabled={busy} onChange={(event) => update(draft.employee_id, { value: event.target.value })} /></label>}
        </div>
        {draft.pay_type === "default" && <p className="small-note">{employee?.compensation_model === "flat_job" ? `${money(number(employee.flat_job_pay_cents))} per job` : ["commission", "hourly_commission"].includes(text(employee?.compensation_model)) ? `${number(employee?.default_commission_bps) / 100}% default commission` : "Hourly pay plan"}. Saved service-specific rules apply. {drafts.length > 1 ? `Default-plan job share: ${draft.share}%.` : ""} Hourly earnings remain separate.</p>}
        {lines.length > 0 && <details className={styles.details} open={draft.line_rules.length > 0}>
          <summary>Different rates for services & upgrades</summary>
          <p className="small-note">Each custom rate replaces this detailer's job rate for that line. Discounts are already included in the amounts below.</p>
          <div className={styles.lineList}>{lines.map((line) => {
            const id = text(line.id), rule = draft.line_rules.find((row) => row.line_item_id === id), part = earned?.lines.find((row) => row.line_item_id === id);
            return <div className={styles.line} key={id}>
              <div className={styles.lineName}><strong>{text(line.name)}</strong><small>{money(part?.net_cents ?? 0)} after discounts</small></div>
              <label className="field"><span>Pay method</span><select aria-label={`${text(line.name)} pay method for ${name(draft.employee_id)}`} value={rule?.pay_type || "default"} disabled={busy} onChange={(event) => lineRate(draft, id, event.target.value)}><option value="default">Use job rate</option><option value="percentage">Percentage</option><option value="flat">Flat amount</option></select></label>
              {rule ? <label className="field"><span>{rule.pay_type === "percentage" ? "Rate (%)" : "Pay ($)"}</span><input aria-label={`${text(line.name)} ${rule.pay_type === "percentage" ? "percentage" : "flat pay"} for ${name(draft.employee_id)}`} type="number" inputMode="decimal" min="0" max={rule.pay_type === "percentage" ? 100 : 1000000} step="0.01" value={rule.value} required disabled={busy} onChange={(event) => update(draft.employee_id, { line_rules: draft.line_rules.map((row) => row.line_item_id === id ? { ...row, value: event.target.value } : row) })} /></label> : <div className={styles.linePay}>Estimated pay<strong>{money(part?.pay_cents ?? 0)}</strong></div>}
              {rule && <small className={styles.lineResult}>This line pays {money(part?.pay_cents ?? 0)}</small>}
            </div>;
          })}</div>
        </details>}
        {assignments[index].commission_override_cents != null && <p className="small-note">This completed job has a saved service-pay amount of {money(assignments[index].commission_override_cents)}. Changing a rate replaces that saved amount.</p>}
        <dl className={styles.totals} aria-live="polite"><div><dt>Service pay</dt><dd>{booking.price_cents == null ? "Quote needed" : money(earned?.commission_cents || 0)}</dd></div><div><dt>Tip</dt><dd>{money(earned?.tips_cents || 0)}</dd></div><div><dt>Job earnings</dt><dd>{booking.price_cents == null ? "Quote needed" : money((earned?.commission_cents || 0) + (earned?.tips_cents || 0))}</dd></div></dl>
      </section>;
    })}
    {drafts.length > 0 && <section className={styles.tip}><label className="field"><span>Who receives the full tip?</span><select value={recipient} required disabled={busy || drafts.length === 1} onChange={(event) => setTipRecipient(event.target.value)}><option value="">Choose the worker who did the job</option>{drafts.map((draft) => <option key={draft.employee_id} value={draft.employee_id}>{name(draft.employee_id)}</option>)}</select></label><p className="small-note">Current tip: {money(number(booking.tip_cents))}. Any tip added later through Square will go to this same detailer.</p></section>}
    {drafts.length > 1 && <details className={styles.details}><summary>Default-plan split</summary><p className="small-note">Only affects saved employee pay plans. Custom job and line percentages or flat amounts are each detailer's direct pay and are not divided again.</p><div className={styles.rateGrid}>{drafts.map((draft) => <label className="field" key={draft.employee_id}><span>{name(draft.employee_id)} share (%)</span><input type="number" min="0" max="100" step="0.01" required value={draft.share} disabled={busy} onChange={(event) => update(draft.employee_id, { share: event.target.value })} /></label>)}</div></details>}
    {drafts.some(draft => !initial.some(row => row.employee_id === draft.employee_id)) && <label className={styles.override}><input type="checkbox" checked={assignmentOverride} disabled={busy} onChange={event => setAssignmentOverride(event.target.checked)}/><span>Manager override: assign outside the schedule or to an overlapping job<small>Confirm the worker can do this job before overriding availability. This decision is recorded.</small></span></label>}
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className={styles.footer}><p className="small-note">Pay enters payroll when the job is marked completed.</p><button className="button" disabled={busy} type="submit">{busy ? "Saving…" : "Save detailers & pay"}</button></div>
  </form>;
}
