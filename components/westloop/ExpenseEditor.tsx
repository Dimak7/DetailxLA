"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { action, Modal, type RecordData } from "./AdminControls";
import { dateToday } from "@/lib/platform/types";
import type { ExpenseDirectory, ExpenseDirectoryEntry, ExpenseDirectoryKind } from "@/lib/platform/expense-directory";

function DirectoryPicker({ kind, entries, value, onChange, onBusyChange, disabled }: {
  kind: ExpenseDirectoryKind;
  entries: ExpenseDirectoryEntry[];
  value: string;
  onChange: (name: string) => void;
  onBusyChange: (busy: boolean) => void;
  disabled: boolean;
}) {
  const id = useId();
  const [choices, setChoices] = useState(entries);
  const [adding, setAdding] = useState(false), [name, setName] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const noun = kind === "vendor" ? "vendor" : "category";
  const options = choices.some((entry) => entry.name === value) || !value
    ? choices : [...choices, { kind, canonical_key: value.toLowerCase(), name: value }];

  async function create() {
    if (busy || disabled || !name.trim()) return;
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      const saved = await action("create_expense_directory_entry", { kind, name });
      const entry = { kind, canonical_key: String(saved.canonical_key), name: String(saved.name) };
      setChoices((current) => [...current.filter((choice) => choice.canonical_key !== entry.canonical_key), entry].sort((a, b) => a.name.localeCompare(b.name)));
      onChange(entry.name);
      setName("");
      setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not add ${noun}.`);
    } finally { setBusy(false); onBusyChange(false); }
  }

  return <div className="field expense-directory-field">
    <label htmlFor={id}>{kind === "vendor" ? "Vendor" : "Expense category"}</label>
    <div className="expense-choice-row">
      <select id={id} value={value} required={kind === "category"} disabled={disabled || busy} onChange={(event) => onChange(event.target.value)}>
        <option value="">{kind === "vendor" ? "No vendor recorded" : "Choose a category"}</option>
        {options.map((entry) => <option key={entry.canonical_key} value={entry.name}>{entry.name}</option>)}
      </select>
      <button type="button" className="button outline" disabled={disabled || busy} aria-expanded={adding} onClick={() => { setAdding(!adding); setError(""); }}>Add {noun}</button>
    </div>
    {adding && <div className="expense-new-choice">
      <label htmlFor={`${id}-new`}>New {noun} name</label>
      <div className="expense-choice-row">
        <input id={`${id}-new`} value={name} maxLength={kind === "vendor" ? 160 : 80} disabled={disabled || busy} autoComplete="off"
          placeholder={kind === "vendor" ? "For example, supplier name" : "For example, Staff training"}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void create(); } }} />
        <button type="button" className="button" disabled={disabled || busy || name.trim().length < 2} onClick={() => void create()}>{busy ? "Adding…" : "Add & select"}</button>
      </div>
      <small>Existing names are reused, including differences in capitalization or spacing.</small>
    </div>}
    {error && <p className="error-message" role="alert">{error}</p>}
  </div>;
}

export function ExpenseEditor({ initial = {}, directory, onClose }: {
  initial?: RecordData;
  directory: ExpenseDirectory;
  onClose: () => void;
}) {
  const router = useRouter();
  const receiptId = useId();
  const [values, setValues] = useState<RecordData>({
    expense_date: dateToday(), category: "Supplies", vendor: "", description: "",
    payment_method: "Card", funding_source: "Business", payment_account: "", marketing_stream: "",
    recurrence: "one_time", recurring_start: "", recurring_end: "", receipt_url: "", notes: "", ...initial,
  });
  const [amount, setAmount] = useState((Number(initial.amount_cents || 0) / 100).toFixed(2));
  const [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false), [error, setError] = useState("");
  const [addingChoice, setAddingChoice] = useState(false);
  const read = (key: string) => String(values[key] ?? "");
  const set = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));

  async function upload(file?: File) {
    if (!file) return;
    setUploading(true); setError("");
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/upload", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Receipt upload failed.");
      set("receipt_url", String(result.url));
    } catch (e) { setError(e instanceof Error ? e.message : "Receipt upload failed."); }
    finally { setUploading(false); }
  }

  const disabled = busy || uploading || addingChoice;
  return <Modal title={initial.id ? "Edit expense" : "Add expense"} onClose={onClose} wide>
    <p className="small-note">Choose a saved vendor and category to keep spending reports together. Add a new name only when you need one.</p>
    <form onSubmit={async (event) => {
      event.preventDefault(); if (disabled) return;
      const cents = Math.round(Number(amount) * 100);
      if (!Number.isFinite(cents) || cents < 0) { setError("Enter a valid expense amount."); return; }
      setBusy(true); setError("");
      try {
        await action("save_expense", { ...values, amount_cents: cents, recurring_start: values.recurring_start || null, recurring_end: values.recurring_end || null });
        router.refresh(); onClose();
      } catch (e) { setError(e instanceof Error ? e.message : "The expense could not be saved."); }
      finally { setBusy(false); }
    }}>
      <div className="form-grid">
        <label className="field"><span>Date</span><input type="date" required value={read("expense_date")} disabled={disabled} onChange={(event) => set("expense_date", event.target.value)} /></label>
        <label className="field"><span>Amount ($)</span><input type="number" inputMode="decimal" required min="0" max="1000000" step="0.01" value={amount} disabled={disabled} onChange={(event) => setAmount(event.target.value)} /></label>
        <DirectoryPicker kind="vendor" entries={directory.vendors} value={read("vendor")} disabled={disabled} onBusyChange={setAddingChoice} onChange={(name) => set("vendor", name)} />
        <DirectoryPicker kind="category" entries={directory.categories} value={read("category")} disabled={disabled} onBusyChange={setAddingChoice} onChange={(name) => set("category", name)} />
        <label className="field"><span>Payment method</span><select value={read("payment_method")} disabled={disabled} onChange={(event) => set("payment_method", event.target.value)}>{[...new Set(["Card", "Cash", "ACH", "Check", "Other", read("payment_method")].filter(Boolean))].map((name) => <option key={name}>{name}</option>)}</select></label>
        <label className="field"><span>Paid from</span><select value={read("funding_source")} disabled={disabled} onChange={(event) => set("funding_source", event.target.value)}>{["Business", "Partner", "Unassigned"].map((name) => <option key={name}>{name}</option>)}</select></label>
        <label className="field"><span>Payment account</span><input value={read("payment_account")} maxLength={100} disabled={disabled} onChange={(event) => set("payment_account", event.target.value)} placeholder="Business checking or Card ending 1234" /><small>Use a label, not a full account number.</small></label>
        <label className="field"><span>Marketing source</span><select value={read("marketing_stream")} disabled={disabled} onChange={(event) => set("marketing_stream", event.target.value)}><option value="">Not a marketing expense</option><option value="business-google">Business Google</option><option value="business-meta">Business Meta</option><option value="dima-google">Partner Google</option></select></label>
        <label className="field"><span>Frequency</span><select value={read("recurrence")} disabled={disabled} onChange={(event) => set("recurrence", event.target.value)}><option value="one_time">One-time</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>
        <div className="field"><label htmlFor={receiptId}>Receipt</label><input id={receiptId} type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={(event) => void upload(event.target.files?.[0])} /><small>{uploading ? "Uploading receipt…" : "JPEG, PNG or WebP. Maximum 5 MB."}</small>{read("receipt_url") && <div className="button-row"><a className="text-link" href={read("receipt_url")} target="_blank" rel="noopener noreferrer">View receipt</a><button type="button" className="link-button" disabled={disabled} onClick={() => set("receipt_url", "")}>Remove attachment</button></div>}</div>
        {read("recurrence") !== "one_time" && <>
          <label className="field"><span>Recurring start</span><input type="date" value={read("recurring_start")} disabled={disabled} onChange={(event) => set("recurring_start", event.target.value)} /></label>
          <label className="field"><span>Recurring end (optional)</span><input type="date" value={read("recurring_end")} disabled={disabled} onChange={(event) => set("recurring_end", event.target.value)} /></label>
        </>}
        <label className="field wide"><span>Description</span><textarea maxLength={2000} value={read("description")} disabled={disabled} onChange={(event) => set("description", event.target.value)} /></label>
        <label className="field wide"><span>Internal notes</span><textarea maxLength={2000} value={read("notes")} disabled={disabled} onChange={(event) => set("notes", event.target.value)} /></label>
      </div>
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="editor-actions"><button className="button" disabled={disabled}>{busy ? "Saving…" : "Save expense"}</button><button type="button" className="button outline" disabled={disabled} onClick={onClose}>Cancel</button></div>
    </form>
  </Modal>;
}
