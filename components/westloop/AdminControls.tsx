"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import modalStyles from "./AdminModal.module.css";
export type RecordData = Record<string, unknown>;
export type Field = {
  key: string;
  label: string;
  type?: string;
  options?: Array<string | { value: string; label: string }>;
  required?: boolean;
  wide?: boolean;
  min?: number;
  max?: number;
  step?: number | "any";
  hint?: string;
  visibleWhen?: (values: RecordData) => boolean;
};
const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const clockValue = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const clockMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return Math.max(0, Math.min(1440, hours * 60 + minutes));
};
export type EditorSpec = {
  title: string;
  action: string;
  fields: Field[];
  initial: RecordData;
  transform?: (d: RecordData) => RecordData;
  selectChanges?: (key: string, value: string) => RecordData | undefined;
  description?: React.ReactNode;
  preview?: (values: RecordData) => React.ReactNode;
  onSaved?: (values:RecordData,result:RecordData|undefined)=>void;
  removeAction?: { action: string; data: RecordData; description: string };
};
export async function action(name: string, data: RecordData) {
  const r = await fetch("/api/manage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: name, data }),
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.error || "The change could not be saved.");
  return d.result as RecordData;
}

// Nested editors share one document lock. Closing a child must leave its parent
// modal in place, and closing the last modal restores the original page position.
const openModals: HTMLDialogElement[] = [];
let documentLock: { restore: () => void; returnFocus: HTMLElement | null } | null = null;
function lockModalDocument(returnFocus: HTMLElement | null) {
  const body = document.body;
  const root = document.documentElement;
  const x = window.scrollX, y = window.scrollY;
  const previous = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    width: body.style.width,
    overflow: body.style.overflow,
    paddingRight: body.style.paddingRight,
    rootOverflow: root.style.overflow,
    scrollBehavior: root.style.scrollBehavior,
  };
  const gutter = Math.max(0, window.innerWidth - root.clientWidth);
  if (gutter) body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight) + gutter}px`;
  root.style.scrollBehavior = "auto";
  root.style.overflow = "hidden";
  body.style.position = "fixed";
  body.style.top = `${-y}px`;
  body.style.left = `${-x}px`;
  body.style.width = "100%";
  body.style.overflow = "hidden";
  return {
    returnFocus,
    restore() {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.left = previous.left;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;
      body.style.paddingRight = previous.paddingRight;
      root.style.overflow = previous.rootOverflow;
      window.scrollTo(x, y);
      root.style.scrollBehavior = previous.scrollBehavior;
    },
  };
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    if (!documentLock) documentLock = lockModalDocument(previous);
    openModals.push(dialog);
    // The browser's top layer keeps dialogs above clipped containers and makes
    // the rest of the page inert, including the mobile navigation underneath.
    if (!dialog.open) dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      const index = openModals.indexOf(dialog);
      if (index !== -1) openModals.splice(index, 1);
      if (dialog.open) dialog.close();
      const parent = openModals.at(-1);
      if (parent) {
        const target = previous?.isConnected && parent.contains(previous)
          ? previous
          : parent.querySelector<HTMLElement>("[data-modal-close]");
        if (!parent.contains(document.activeElement)) target?.focus({ preventScroll: true });
      } else {
        const lock = documentLock;
        documentLock = null;
        lock?.restore();
        if (lock?.returnFocus?.isConnected) lock.returnFocus.focus({ preventScroll: true });
      }
    };
  }, []);
  return (
    <dialog
      className={modalStyles.viewport}
      ref={ref}
      aria-label={title}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
    >
      <div
        className={`modal ${modalStyles.panel}${wide ? " wide-modal" : ""}`}
      >
        <div className={`modal-header ${modalStyles.header}`}>
          <h2>{title}</h2>
          <button ref={closeRef} className={modalStyles.close} data-modal-close type="button" onClick={onClose}>Close</button>
        </div>
        <div className={modalStyles.body}>{children}</div>
      </div>
    </dialog>
  );
}
export function Editor({
  spec,
  onClose,
}: {
  spec: EditorSpec;
  onClose: () => void;
}) {
  const [v, setV] = useState<RecordData>(spec.initial),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmRemoval, setConfirmRemoval] = useState(false);
  const router = useRouter();
  async function remove() {
    if (!spec.removeAction || busy) return;
    setBusy(true);
    setError("");
    try {
      await action(spec.removeAction.action, spec.removeAction.data);
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The rule could not be removed.");
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File | undefined, key: string) {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setV((s) => ({ ...s, [key]: d.url }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={spec.title} onClose={onClose} wide={spec.fields.some((f) => f.type === "availability")}>
      {spec.description}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || confirmRemoval) return;
          setBusy(true);
          setError("");
          try {
            const d = { ...v };
            for (const f of spec.fields) {
              if (f.type === "number") d[f.key] = Number(v[f.key] || 0);
              if (f.type === "money") d[f.key] = Math.round(Number(v[f.key] || 0) * 100);
              if (f.type === "lines")
                d[f.key] = String(v[f.key] || "")
                  .split("\n")
                  .map((x) => x.trim())
                  .filter(Boolean);
              if (f.type === "checkbox") d[f.key] = Boolean(v[f.key]);
              if (f.type === "nullable-select") d[f.key] = v[f.key] || null;
              if (f.type === "datetime-local")
                d[f.key] = v[f.key]
                  ? new Date(String(v[f.key])).toISOString()
                  : null;
            }
            const result=await action(spec.action, spec.transform ? spec.transform(d) : d);
            spec.onSaved?.(d,result);
            router.refresh();
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Please try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          {spec.fields.filter((f) => !f.visibleWhen || f.visibleWhen(v)).map((f) => (
            <label key={f.key} className={"field" + (f.wide ? " wide" : "")}>
              <span>{f.label}</span>
              {f.type === "checkbox" ? (
                <input
                  type="checkbox"
                  checked={!!v[f.key]}
                  onChange={(e) => setV({ ...v, [f.key]: e.target.checked })}
                />
              ) : f.type === "availability" ? (
                <div className="availability-editor">
                  {dayNames.map((day, weekday) => {
                    const values = Array.isArray(v[f.key]) ? v[f.key] as Array<Record<string, unknown>> : [];
                    const current = values.find((item) => Number(item.weekday) === weekday) || { weekday, available: false, start_minute: 480, end_minute: 1020 };
                    const replace = (next: Record<string, unknown>) => setV({ ...v, [f.key]: dayNames.map((_, index) => index === weekday ? next : (values.find((item) => Number(item.weekday) === index) || { weekday: index, available: false, start_minute: 480, end_minute: 1020 })) });
                    return <div className="availability-day" key={day}>
                      <label><input type="checkbox" checked={Boolean(current.available)} onChange={(e) => replace({ ...current, available: e.target.checked })} /> {day}</label>
                      <input aria-label={day + " start"} type="time" disabled={!current.available} value={clockValue(Number(current.start_minute))} onChange={(e) => replace({ ...current, start_minute: clockMinutes(e.target.value) })} />
                      <span>to</span>
                      <input aria-label={day + " end"} type="time" disabled={!current.available} value={clockValue(Number(current.end_minute))} onChange={(e) => replace({ ...current, end_minute: clockMinutes(e.target.value) })} />
                    </div>;
                  })}
                </div>
              ) : f.type === "upload" ? (
                <>
                  {!!v[f.key] && (
                    <img
                      className="upload-preview"
                      alt="Selected upload"
                      src={String(v[f.key])}
                    />
                  )}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => upload(e.target.files?.[0], f.key)}
                  />
                  <small>JPEG, PNG or WebP. Maximum 5 MB.</small>
                  {!!v[f.key] && (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => setV({ ...v, [f.key]: "" })}
                    >
                      Clear image
                    </button>
                  )}
                </>
              ) : f.options ? (
                <select
                  required={f.required}
                  value={String(v[f.key] ?? "")}
                  onChange={(e) => {
                    const value = e.target.value;
                    setV((current) => ({ ...current, [f.key]: value, ...spec.selectChanges?.(f.key, value) }));
                  }}
                >
                  {f.options.map((o) => (
                    <option
                      key={typeof o === "string" ? o : o.value}
                      value={typeof o === "string" ? o : o.value}
                    >
                      {typeof o === "string" ? o : o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === "textarea" || f.type === "lines" ? (
                <textarea
                  required={f.required}
                  maxLength={2000}
                  value={String(v[f.key] ?? "")}
                  onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
                />
              ) : (
                <input
                  type={f.type === "money" ? "number" : f.type || "text"}
                  step={f.step ?? (f.type === "money" ? "0.01" : undefined)}
                  min={
                    f.min ??
                    (["number", "money"].includes(f.type || "") ? 0 : undefined)
                  }
                  max={f.max}
                  required={f.required}
                  autoComplete={f.type === "password" ? "new-password" : "off"}
                  value={String(v[f.key] ?? "")}
                  onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
                />
              )}{" "}
              {f.hint && <small className="muted">{f.hint}</small>}
            </label>
          ))}
        </div>
        {spec.preview?.(v)}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {confirmRemoval && spec.removeAction ? (
          <div className="editor-remove-confirmation" role="group" aria-label="Confirm rule removal">
            <strong>Remove this saved rule?</strong>
            <p className="small-note">{spec.removeAction.description}</p>
            <div className="editor-actions">
              <button type="button" className="button button-danger" disabled={busy} onClick={remove}>{busy ? "Removing..." : "Remove rule"}</button>
              <button type="button" className="button outline" disabled={busy} onClick={() => { setConfirmRemoval(false); setError(""); }}>Keep rule</button>
            </div>
          </div>
        ) : (
          <div className="editor-actions">
            <button className="button" disabled={busy}>{busy ? "Saving..." : "Save changes"}</button>
            {spec.removeAction && <button type="button" className="button button-danger" disabled={busy} onClick={() => { setConfirmRemoval(true); setError(""); }}>Remove rule</button>}
          </div>
        )}
      </form>
    </Modal>
  );
}
export function IntegrationStatus({ value }: { value: RecordData }) {
  return (
    <>
      <div className="integration-list">
        {Object.entries(value)
          .filter(([k]) => k !== "credentials")
          .map(([k, v]) => (
            <div key={k}>
              <strong>{k.replaceAll("_", " ")}</strong>
              <span className="status-pill">
                {v ? "Connected configuration" : "Not connected"}
              </span>
            </div>
          ))}
      </div>
      <p className="small-note">
        Connected configuration means required settings are present, not that
        delivery was verified. Check message logs for actual provider results.
        Review ad-account sync status in Marketing. Manual spend entries are
        separate from imported ad metrics.
      </p>
    </>
  );
}
