"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./TestDataCleanup.module.css";
type Candidate = { id: string; name: string; email: string; phone: string; bookings?: number; leads?: number; blocked_reason: string };
type Archive = { id: string; label: string; created_at: string; restored_at: string | null; customer_count: number; lead_count: number; booking_count: number };
type Preview = { customers: Candidate[]; leads: Candidate[]; archives: Archive[] };
const looksLikeTest = (value: Candidate) => /\btest\b|example\.(?:com|test)/i.test(`${value.name} ${value.email}`);
export function TestDataCleanup() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState({ customers: [] as string[], leads: [] as string[] });
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const router = useRouter();
  async function load() {
    const response = await fetch("/api/admin/test-data", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load records.");
    setPreview(result);
  }
  async function open() {
    setBusy(true); setError("");
    try { await load(); } catch (error) { setError(error instanceof Error ? error.message : "Unable to load records."); } finally { setBusy(false); }
  }
  async function run(action: "archive" | "restore", data: unknown) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/test-data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The records could not be updated.");
      setSelected({ customers: [], leads: [] }); setConfirmed(false);
      setNotice(action === "archive" ? "Selected test records archived. You can restore them below." : "Records restored. Old test messages will not be resent.");
      await load(); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "The records could not be updated."); } finally { setBusy(false); }
  }
  const count = selected.customers.length + selected.leads.length;
  return <section className={`paper ${styles.panel}`}>
    <div className="section-heading"><div><p className="eyebrow">DATA HOUSEKEEPING</p><h2>Test records</h2></div><button type="button" disabled={busy} onClick={open}>{busy ? "Loading…" : preview ? "Refresh records" : "Review test records"}</button></div>
    <p className="small-note">Select only records you recognize as tests. Customer records include their appointments, vehicles, enquiries and activity. Real or unverified payments, invoices, imported Square and paid payroll history are protected. Verified Square sandbox payments can be archived with their test appointments; Square’s original ledger stays intact. Every archive can be restored here.</p>
    {error && <p className="error-message" role="alert">{error}</p>}
    {notice && <p className="success-message" role="status">{notice}</p>}
    {preview && <>
      {(["customers", "leads"] as const).map(kind => <fieldset key={kind} className={styles.group} disabled={busy}>
        <legend>{kind === "customers" ? "Customers & their appointments" : "Standalone enquiries"}</legend>
        {preview[kind].length === 0 ? <p className="small-note">No records to review.</p> : <div className={styles.records}>{preview[kind].map(record => <label key={record.id} className={styles.record}>
          <input type="checkbox" checked={selected[kind].includes(record.id)} disabled={Boolean(record.blocked_reason)} onChange={event => { setConfirmed(false); setSelected(previous => ({ ...previous, [kind]: event.target.checked ? [...previous[kind], record.id] : previous[kind].filter(id => id !== record.id) })); }} />
          <span><strong>{record.name || "Unnamed enquiry"}</strong><small>{record.email || record.phone || "No contact details"}</small>{kind === "customers" && <small>{record.bookings || 0} appointments · {record.leads || 0} enquiries</small>}<small>{record.blocked_reason ? `Protected: ${record.blocked_reason}` : looksLikeTest(record) ? "Possible test — confirm before selecting" : "Review carefully before selecting"}</small></span>
        </label>)}</div>}
      </fieldset>)}
      {count > 0 && <div className={styles.confirm}>
        <strong>{count} selected records and their linked history</strong>
        <label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy} /> I recognize these as test data and want to archive them.</label>
        <button type="button" className="button" disabled={busy || !confirmed} onClick={() => run("archive", { ...selected, confirm_test_data: true })}>{busy ? "Saving…" : "Archive selected test records"}</button>
      </div>}
      <h3>Recoverable archives</h3>
      {preview.archives.length === 0 ? <p className="small-note">No test records have been archived.</p> : <div className={styles.archives}>{preview.archives.map(archive => <article key={archive.id}>
        <div><strong>{archive.label}</strong><small>{archive.customer_count} customers · {archive.lead_count} enquiries · {archive.booking_count} appointments</small><small>{new Date(archive.created_at).toLocaleString("en-US", { timeZone: "America/Chicago" })} Central</small></div>
        {archive.restored_at ? <span>Restored</span> : <button type="button" disabled={busy} onClick={() => run("restore", { id: archive.id })}>Restore records</button>}
      </article>)}</div>}
    </>}
  </section>;
}
