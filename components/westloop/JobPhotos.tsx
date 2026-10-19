"use client";
import { useState } from "react";
import { Modal } from "./AdminControls";
type Photo = { id: string; stage: string; caption: string; created_at: string; uploaded_by: string };
export function JobPhotos({ bookingId, reference }: { bookingId: string; reference: string }) {
  const [open, setOpen] = useState(false), [photos, setPhotos] = useState<Photo[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function load() {
    const response = await fetch(`/api/bookings/${bookingId}/photos`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load photos.");
    setPhotos(data.photos);
  }
  async function launch() {
    setOpen(true); setError(""); setBusy(true);
    try { await load(); } catch (e) { setError(e instanceof Error ? e.message : "Could not load photos."); } finally { setBusy(false); }
  }
  async function upload(files: FileList | File[], stage: string) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      for (const file of Array.from(files)) {
        const form = new FormData(); form.set("file", file); form.set("stage", stage);
        const response = await fetch(`/api/bookings/${bookingId}/photos`, { method: "POST", body: form });
        const data = await response.json();
        if (!response.ok) throw new Error(`${file.name}: ${data.error || "Upload failed."}`);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed."); }
    finally { try { await load(); } catch { /* Preserve upload error. */ } setBusy(false); }
  }
  return <><button onClick={() => void launch()}>Before / after photos</button>{open && <Modal title={`Job photos · ${reference}`} onClose={() => setOpen(false)} wide>
    <p>Private photos for this appointment. JPEG, PNG or WebP, up to 8 MB each. Choose photos or drag them into a box.</p>
    {error && <p className="error-message" role="alert">{error}</p>}
    {busy && <p role="status">Loading / saving photos…</p>}
    <div className="job-photo-columns">{["before", "after"].map(stage => <section key={stage}><h3>{stage === "before" ? "Before the detail" : "After the detail"}</h3>
      <label className="job-photo-drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) void upload(e.dataTransfer.files, stage); }}>
        <strong>Drop {stage} photos here</strong><span>or choose photos</span>
        <input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy} aria-label={`Upload ${stage} photos`} onChange={e => { if (e.target.files) void upload(e.target.files, stage); e.target.value = ""; }} />
      </label><div className="job-photo-grid">{photos.filter(p => p.stage === stage).map(p => <figure key={p.id}><a href={`/api/booking-photos/${p.id}`} target="_blank" rel="noreferrer"><img src={`/api/booking-photos/${p.id}`} alt={`${stage} photo for ${reference}`} loading="lazy" /></a><figcaption>{p.uploaded_by} · {new Date(p.created_at).toLocaleDateString()}{p.caption && <span>{p.caption}</span>}</figcaption></figure>)}</div>
      {!photos.some(p => p.stage === stage) && <p className="small-note">No {stage} photos yet.</p>}
    </section>)}</div>
  </Modal>}</>;
}
