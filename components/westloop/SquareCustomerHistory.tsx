"use client";

import Link from "next/link";
import { useEffect, useState, type ChangeEvent } from "react";
import type { SquareCustomerHistoryRow, SquareCustomerHistorySummary } from "@/lib/platform/square-customer-history";
import { money } from "@/lib/platform/types";
import { ArchiveCustomer } from "./ArchiveCustomer";
import styles from "./SquareCustomerHistory.module.css";

type History = { rows: SquareCustomerHistoryRow[]; summary: SquareCustomerHistorySummary; page: number; pages: number };
type Preview = { summary: SquareCustomerHistorySummary; added: number; existing: number };
const endpoint = "/api/admin/square-customer-history";
function visit(value: string | null) { return value ? new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "Not recorded"; }

export default function SquareCustomerHistory({ onImported, refreshKey = 0 }: { onImported?: () => void; refreshKey?: number } = {}) {
  const [history, setHistory] = useState<History | null>(null), [page, setPage] = useState(1), [version, setVersion] = useState(0);
  const [upload, setUpload] = useState<{ csv: string; filename: string } | null>(null), [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [search, setSearch] = useState(""), [searchDraft, setSearchDraft] = useState("");
  const [archived, setArchived] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${endpoint}?page=${page}&search=${encodeURIComponent(search)}${archived ? "&archived=1" : ""}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load Square history.");
      setHistory(data);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [page, version, search, archived, refreshKey]);
  function archiveChanged() {
    setPage(1);
    setHistory(null);
    setVersion(value => value + 1);
    onImported?.();
  }
  async function send(csv: string, filename: string, preview: boolean) {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv, filename, preview }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not import Square history.");
    return data;
  }
  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    setUpload(null); setPreview(null); setError(""); setMessage("");
    if (!file) return;
    if (file.size > 1_000_000) { setError("Choose a Square customer CSV smaller than 1 MB."); return; }
    setBusy(true);
    try { const csv = await file.text(); setPreview(await send(csv, file.name, true)); setUpload({ csv, filename: file.name }); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not preview this file."); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!upload || busy) return;
    setBusy(true); setError("");
    try {
      const result = await send(upload.csv, upload.filename, false);
      setMessage(`${result.summary.profiles} Square profiles saved. ${result.customers_added} new email contacts added to Customers; ${result.existing} existing history profiles refreshed.`);
      setPreview(null); setUpload(null); setPage(1); setVersion(version => version + 1);
      onImported?.();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not import this file."); }
    finally { setBusy(false); }
  }
  return <section className={`paper ${styles.section}`} aria-labelledby="square-history-title">
    <div className="section-heading"><div><p className="eyebrow">SQUARE CUSTOMER HISTORY</p><h2 id="square-history-title">Your earlier customer records</h2></div>
      {!!history?.summary.profiles && <a className="button secondary" href={`${endpoint}?export=csv${archived ? "&archived=1" : ""}`}>Export {archived ? "archived " : ""}history</a>}
    </div>
    <p className="small-note">Customer visits and lifetime spend from your Square export. These historical totals are kept separate from dashboard revenue, which uses actual payment records.</p>
    <label className={`field ${styles.upload}`}><span>Import a Square customer CSV</span><input type="file" accept=".csv,text/csv" disabled={busy} onChange={choose} /><small>Review the file before importing. Existing Square IDs are updated without creating duplicate customers.</small></label>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {message && <p role="status" className={styles.message}>{message}</p>}
    {busy && <p role="status" className="small-note">{preview ? "Saving customer history…" : "Reading Square export…"}</p>}
    {preview && <div className={styles.preview}>
      <h3>Ready to import {preview.summary.profiles} profiles</h3>
      <p className="small-note">{upload?.filename}</p>
      <p>{preview.added} new · {preview.existing} already imported · {preview.summary.transactions} historical transactions · {money(preview.summary.lifetime_spend_cents)} lifetime spend</p>
      <p className="small-note">Profiles with a valid email are added to Customers or matched to an existing record. Other profiles stay here with all available details. {preview.summary.anonymous} profiles have no contact details. Unknown subscription status does not enable promotional email.</p>
      <div className={styles.actions}><button className="button" disabled={busy} onClick={save}>Import customer history</button><button className="button secondary" disabled={busy} onClick={() => { setPreview(null); setUpload(null); }}>Cancel</button></div>
    </div>}
    <div className={styles.recordTabs} role="group" aria-label="Square customer record status">
      <button type="button" aria-pressed={!archived} onClick={() => { if (archived) { setHistory(null); setArchived(false); setPage(1); } }}>Active Square profiles</button>
      <button type="button" aria-pressed={archived} onClick={() => { if (!archived) { setHistory(null); setArchived(true); setPage(1); } }}>Archived Square profiles</button>
    </div>
    {archived && <p className="small-note">Archived profiles are excluded from the active customer list and promotional campaigns. Original Square records and payment history stay available.</p>}
    <form className={`toolbar ${styles.search}`} onSubmit={event => { event.preventDefault(); setSearch(searchDraft); setPage(1); }}><label className="field"><span>Find a Square profile</span><input value={searchDraft} onChange={event => setSearchDraft(event.target.value)} placeholder="Name, email, phone or Square ID" /></label><button className="button secondary">Search history</button></form>
    {history && !!history.summary.profiles ? <>
      <div className={styles.stats}><div><small>Profiles</small><strong>{history.summary.profiles}</strong></div><div><small>Historical transactions</small><strong>{history.summary.transactions}</strong></div><div><small>Historical lifetime spend</small><strong>{money(history.summary.lifetime_spend_cents)}</strong></div></div>
      <div className={styles.tableWrap} role="region" aria-label="Square customer history. Scroll horizontally for all columns." tabIndex={0}><table className={styles.table}><thead><tr><th>Customer</th><th>Visits</th><th>Transactions</th><th>Lifetime spend</th></tr></thead><tbody>{!history.rows.length && <tr><td colSpan={4}>No Square profiles match this search.</td></tr>}{history.rows.map(row => <tr key={row.square_customer_id}>
        <td><strong>{[row.first_name, row.last_name].filter(Boolean).join(" ") || `Square profile · ${row.square_customer_id.slice(-6)}`}</strong><small>{[row.email, row.phone].filter(Boolean).join(" · ") || "No contact details in export"}</small><small>Email status: {row.email_subscription_status || "Unknown"}</small>
          <div className={styles.rowActions}>
            {row.customer_id && <Link className="text-link" href={`/admin/customers?id=${row.customer_id}${row.archived_at ? "&archived=1" : ""}`}>Open customer</Link>}
            <ArchiveCustomer
              kind={(row.archived_at ? row.archived_customer_id : row.customer_id) ? "customer" : "square-profile"}
              id={(row.archived_at ? row.archived_customer_id : row.customer_id) || row.square_customer_id}
              name={[row.first_name, row.last_name].filter(Boolean).join(" ") || row.email || `Square profile ${row.square_customer_id.slice(-6)}`}
              archived={Boolean(row.archived_at)} onChanged={archiveChanged}
            />
          </div>
          <details className={styles.details}><summary>All saved details</summary><dl>{Object.entries(row.source_fields || {}).filter(([, value]) => value.trim()).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><small>Source: {row.source_filename}</small></details>
        </td>
        <td><span>Last: {visit(row.last_visit)}</span><small>First: {visit(row.first_visit)}</small></td><td>{row.transaction_count}</td><td>{money(row.lifetime_spend_cents)}</td>
      </tr>)}</tbody></table></div>
      {history.pages > 1 && <div className={styles.pagination}><button className="button secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {history.page} of {history.pages}</span><button className="button secondary" disabled={page >= history.pages} onClick={() => setPage(page + 1)}>Next</button></div>}
    </> : history ? <p className="small-note">{search ? "No Square profiles match this search." : archived ? "No archived Square profiles." : "No active Square profiles imported yet."}</p> : <p className="small-note">Loading history…</p>}
  </section>;
}
