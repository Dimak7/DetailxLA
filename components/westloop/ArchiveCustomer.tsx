"use client";

import { useCallback, useState } from "react";
import { Modal } from "./AdminControls";
import styles from "./ArchiveCustomer.module.css";

export function ArchiveCustomer({ kind, id, name, archived, onChanged }: {
  kind: "customer" | "square-profile";
  id: string;
  name: string;
  archived: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = useCallback(() => { if (!busy) setOpen(false); }, [busy]);

  async function save() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/customer-archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id, action: archived ? "restore" : "archive" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update this customer record.");
      setOpen(false);
      onChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update this customer record.");
    } finally { setBusy(false); }
  }

  return <>
    <button type="button" className={styles.trigger} onClick={() => { setError(""); setOpen(true); }} disabled={busy} aria-label={`${archived ? "Restore" : "Archive"} ${name}`}>
      {archived ? "Restore" : "Archive"}
    </button>
    {open && <Modal title={`${archived ? "Restore" : "Archive"} ${name}?`} onClose={close}>
      <p>{archived
        ? "This record will return to the active customer list. Existing marketing preferences still apply."
        : "This record will move out of the active customer list and will be excluded from promotional campaigns. You can restore it from Archived records at any time."}</p>
      <p className="small-note">Bookings, payments and financial history stay available.{kind === "customer" ? " Linked Square customer profiles move with this record." : " This updates your website’s customer list; the original Square account is unchanged."}</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="button" className="button" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : archived ? "Restore record" : "Archive record"}</button>
        <button type="button" className="button secondary" disabled={busy} onClick={close}>Cancel</button>
      </div>
    </Modal>}
  </>;
}
