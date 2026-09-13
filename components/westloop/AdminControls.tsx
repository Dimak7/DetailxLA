"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
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
  hint?: string;
};
export type EditorSpec = {
  title: string;
  action: string;
  fields: Field[];
  initial: RecordData;
  transform?: (d: RecordData) => RecordData;
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
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const items = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select,textarea,[tabindex="0"]',
        );
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop">
      <div
        className={"modal" + (wide ? " wide-modal" : "")}
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
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
    [busy, setBusy] = useState(false);
  const router = useRouter();
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
    <Modal title={spec.title} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const d = { ...v };
            for (const f of spec.fields) {
              if (f.type === "number" || f.type === "money")
                d[f.key] = Math.round(
                  Number(v[f.key] || 0) * (f.type === "money" ? 100 : 1),
                );
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
            await action(spec.action, spec.transform ? spec.transform(d) : d);
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
          {spec.fields.map((f) => (
            <label key={f.key} className={"field" + (f.wide ? " wide" : "")}>
              <span>{f.label}</span>
              {f.type === "checkbox" ? (
                <input
                  type="checkbox"
                  checked={!!v[f.key]}
                  onChange={(e) => setV({ ...v, [f.key]: e.target.checked })}
                />
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
                  onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
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
                  step={f.type === "money" ? "0.01" : undefined}
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
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <button className="button" disabled={busy}>
          {busy ? "Saving..." : "Save changes"}
        </button>
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
        Ad account reporting is not connected; enter verified spend manually in
        Marketing.
      </p>
    </>
  );
}
