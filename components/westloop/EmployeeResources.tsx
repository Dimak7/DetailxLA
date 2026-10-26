"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./AdminControls";
import type { EmployeeResource, EmployeeResourceData, EmployeeResourceKind } from "@/lib/platform/employee-resources";
import styles from "./EmployeeResources.module.css";

const kinds: Record<EmployeeResourceKind, string> = {
  training: "Training video", checklist: "Checklist", contract: "Contract", document: "Document",
};
type ResourceDraft = { id?: string; title: string; kind: EmployeeResourceKind; url: string; description: string; employee_id: string; active: boolean };
const emptyDraft: ResourceDraft = { title: "", kind: "training", url: "", description: "", employee_id: "", active: true };

async function resourceAction<T>(action: string, data: unknown): Promise<T> {
  const response = await fetch("/api/admin/employee-resources", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "The change could not be saved.");
  return body.result as T;
}

export function EmployeeResources({ manage = false }: { manage?: boolean }) {
  const [data, setData] = useState<EmployeeResourceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<ResourceDraft | null>(null);
  const [editorError, setEditorError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [filter, setFilter] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/admin/employee-resources" + (manage ? "?manage=1" : ""), { cache: "no-store", signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Resources could not be loaded.");
    setData(body as EmployeeResourceData);
  }, [manage]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void load(controller.signal).catch(e => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Resources could not be loaded.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load]);

  function edit(resource?: EmployeeResource) {
    setEditorError("");
    setDraft(resource ? { ...resource, employee_id: resource.employee_id || "" } : { ...emptyDraft });
    // A newly added employee may not have existed when this panel first loaded.
    if (manage) void load().catch(e => setEditorError(e instanceof Error ? e.message : "Employee list could not be refreshed."));
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || busy) return;
    setBusy(true);
    setEditorError("");
    try {
      const saved = await resourceAction<{ id: string }>("save", { ...draft, employee_id: draft.employee_id || null });
      setDraft(current => current ? { ...current, id: saved.id } : current);
      await load();
      setDraft(null);
    } catch (e) { setEditorError(e instanceof Error ? e.message : "Resource could not be saved."); }
    finally { setBusy(false); }
  }
  async function archive(resource: EmployeeResource) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await resourceAction("archive", { id: resource.id });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Resource could not be archived."); }
    finally { setBusy(false); }
  }
  const resources = (data?.resources || []).filter(resource => (showArchived || resource.active) && (!filter || resource.kind === filter));
  const archivedCount = data?.resources.filter(resource => !resource.active).length || 0;
  return <section className={`paper ${styles.resources}`} aria-busy={loading}>
    <div className="section-heading">
      <div><p className="eyebrow">TEAM RESOURCES</p><h2>{manage ? "Training & employee documents" : "Your training & documents"}</h2></div>
      {data?.can_manage && <button className="button" onClick={() => edit()}>Add resource</button>}
    </div>
    <p className={styles.intro}>{manage ? "Keep videos, checklists and individual documents in one place. Shared resources appear in every employee’s workspace." : "Open your training videos, work checklists and personal documents here."}</p>
    {!manage && data && <div className={styles.loginInfo}><span>Your login</span><strong>{data.login_email}</strong><a href="/admin/login">Sign-in page</a></div>}
    {loading && <p role="status">Loading your resources…</p>}
    {error && <p className="error-message" role="alert">{error}</p>}
    {!loading && data && <>
      {(data.resources.length > 0 || archivedCount > 0) && <div className={styles.filters}>
        <label className="field"><span>Resource type</span><select value={filter} onChange={e => setFilter(e.target.value)}><option value="">All resources</option>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {manage && archivedCount > 0 && <label className={styles.archiveToggle}><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Show archived ({archivedCount})</label>}
      </div>}
      {resources.length === 0 ? <div className={styles.empty}><strong>{filter ? "No resources in this category" : "Ready for your first resource"}</strong><p>{manage ? "Add a YouTube training video, a PDF checklist or a document link. Assign contracts to the employee they belong to." : "Your manager will add your training and documents here. Check back once they have shared them with you."}</p></div> : <div className={styles.grid}>
        {resources.map(resource => <article key={resource.id} className={styles.card}>
          <div className={styles.cardMeta}><span>{kinds[resource.kind]}</span>{!resource.active && <span>Archived</span>}</div>
          <h3>{resource.title}</h3>
          <p className={styles.audience}>{resource.employee_id ? (manage ? `For ${resource.employee_name || "selected employee"}` : "Personal document") : "Shared with the team"}</p>
          {resource.description && <p className={styles.description}>{resource.description}</p>}
          <div className={styles.actions}>
            <a className={`button outline ${styles.openLink}`} href={resource.url} target="_blank" rel="noopener noreferrer">{resource.kind === "training" ? "Watch video" : resource.kind === "checklist" ? "Open checklist" : "Open document"}</a>
            {manage && resource.can_edit && <div className={styles.managementActions}>
              <button onClick={() => edit(resource)} disabled={busy}>{resource.active ? "Edit" : "Edit / restore"}</button>
              {resource.active && <button onClick={() => void archive(resource)} disabled={busy}>Archive</button>}
            </div>}
          </div>
        </article>)}
      </div>}
    </>}
    {draft && <Modal title={draft.id ? "Edit employee resource" : "Add employee resource"} onClose={() => { if (!busy) setDraft(null); }}>
      <form className={styles.editor} onSubmit={save}>
        <div className="form-grid">
          <label className="field"><span>Resource type</span><select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as EmployeeResourceKind })}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field"><span>Who can see it</span><select required={draft.kind === "contract"} value={draft.employee_id} onChange={e => setDraft({ ...draft, employee_id: e.target.value })}><option value="" disabled={draft.kind === "contract"}>{draft.kind === "contract" ? "Choose an employee" : "Everyone on the team"}</option>{data?.employees.map(employee => <option key={employee.id} value={employee.id} disabled={!employee.active && employee.id !== draft.employee_id}>{employee.name}{employee.active ? "" : " (inactive)"}</option>)}</select></label>
          <label className="field wide"><span>Title</span><input autoComplete="off" required minLength={2} maxLength={140} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="For example, Interior detailing checklist" /></label>
          <label className="field wide"><span>{draft.kind === "training" ? "Video link" : "Document link"}</span><input type="url" required maxLength={2048} value={draft.url} onChange={e => setDraft({ ...draft, url: e.target.value })} placeholder={draft.kind === "training" ? "https://www.youtube.com/watch?v=…" : "https://…"} /><small>Use a link the employee can open. For personal documents, also restrict access in the file’s sharing settings.</small></label>
          <label className="field wide"><span>Instructions (optional)</span><textarea rows={3} maxLength={2000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="When to use this resource or what to review." /></label>
          {draft.id && <label className={styles.archiveToggle}><input type="checkbox" checked={draft.active} onChange={e => setDraft({ ...draft, active: e.target.checked })} /> Available to employees</label>}
        </div>
        {editorError && <p className="error-message" role="alert">{editorError}</p>}
        <div className={styles.actions}><button className="button" disabled={busy} type="submit">{busy ? "Saving…" : "Save resource"}</button><button type="button" className={styles.secondary} disabled={busy} onClick={() => setDraft(null)}>Cancel</button></div>
      </form>
    </Modal>}
  </section>;
}

type AccessLink = { url: string; login_url: string; email: string; expires_at: string; created_login: boolean };
export function EmployeeAccessLink({ employeeId, employeeName, email, hasLogin = true, disabled = false }: {
  employeeId: string; employeeName: string; email: string; hasLogin?: boolean; disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [result, setResult] = useState<AccessLink | null>(null), [error, setError] = useState(""), [copied, setCopied] = useState(false);
  async function create() {
    if (busy) return;
    setBusy(true); setError(""); setCopied(false);
    try {
      setResult(await resourceAction<AccessLink>("access_link", { employee_id: employeeId }));
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "The setup link could not be created."); }
    finally { setBusy(false); }
  }
  async function copy() {
    if (!result) return;
    try { await navigator.clipboard.writeText(result.url); setCopied(true); }
    catch { setError("Select the setup link below and copy it manually."); }
  }
  return <>
    <button disabled={disabled} onClick={() => { setOpen(true); setResult(null); setError(""); setCopied(false); }}>Login access</button>
    {open && <Modal title={`${employeeName} · Login access`} onClose={() => { if (!busy) setOpen(false); }}>
      <div className={styles.accessPanel}>
        <div className={styles.loginInfo}><span>Login email</span><strong>{result?.email || email}</strong><span>{hasLogin || result ? "Individual team account" : "A separate staff login will be created"}</span></div>
        <p>{hasLogin ? "Share a secure setup link so this employee can choose a new password." : "Create a secure setup link so this employee can choose their own password and sign in to their workspace."}</p>
        <p className="small-note">The link expires after 30 minutes and works once. Share it privately with this employee. Their existing password stays valid until they choose a new one.</p>
        {result ? <>
          <label className="field"><span>Private password setup link</span><input readOnly value={result.url} onFocus={e => e.currentTarget.select()} autoComplete="off" /></label>
          <div className={styles.actions}><button className="button" onClick={() => void copy()}>{copied ? "Copied" : "Copy setup link"}</button><button className={styles.secondary} onClick={() => void create()} disabled={busy}>{busy ? "Creating…" : "Replace with a new link"}</button></div>
          <p className="small-note">After setting their password, they sign in at <a href={result.login_url} target="_blank" rel="noopener noreferrer">{result.login_url}</a>.</p>
          <p role="status">{result.created_login ? "Staff account created. " : ""}Setup link ready. Expires at {new Date(result.expires_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</p>
        </> : <button className="button" onClick={() => void create()} disabled={busy}>{busy ? "Creating…" : "Create password setup link"}</button>}
        {error && <p className="error-message" role="alert">{error}</p>}
      </div>
    </Modal>}
  </>;
}
