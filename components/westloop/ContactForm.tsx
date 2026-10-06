"use client";
import { useState, type FormEvent } from "react";
import { visitor } from "./Tracking";
import styles from "./ContactForm.module.css";
export function ContactForm() {
  const [status, setStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setStatus(null);
    try {
      const data = Object.fromEntries(new FormData(form));
      const r = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, ...visitor() }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      setStatus({ kind: "success", message: "Your enquiry has been received. We’ll reply using the contact details you shared." });
      form.reset();
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : "We couldn’t send your message. Please try again." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className={styles.form} onSubmit={submit} aria-labelledby="enquiry-title" aria-busy={busy}>
      <label className={styles.field}>
        <span>Your name</span>
        <input name="name" required minLength={2} maxLength={160} autoComplete="name" placeholder="Full name" />
      </label>
      <div className={styles.pair}>
        <label className={styles.field}>
          <span>Email</span>
          <input name="email" type="email" required autoComplete="email" placeholder="you@example.com" />
        </label>
        <label className={styles.field}>
          <span>Phone <small>(optional)</small></span>
          <input name="phone" type="tel" maxLength={30} autoComplete="tel" placeholder="Phone number" />
        </label>
      </div>
      <label className={styles.field}>
        <span>What can we help with?</span>
        <textarea name="notes" required minLength={5} maxLength={2000} rows={4} placeholder="Your car’s make and model, and what you’d like cleaned, corrected or protected." />
      </label>
      <p className={styles.privacy}>
        We use these details to respond to your enquiry. Read our{" "}
        <a href="/privacy-notice">privacy notice</a>.
      </p>
      <button type="submit" disabled={busy} className="button">
        {busy ? "Sending..." : "Send enquiry"}
      </button>
      {status && <div className={styles.feedback} data-kind={status.kind} role={status.kind === "error" ? "alert" : "status"}><strong>{status.kind === "success" ? "Thanks for getting in touch." : "Message not sent."}</strong><p>{status.message}</p></div>}
    </form>
  );
}
