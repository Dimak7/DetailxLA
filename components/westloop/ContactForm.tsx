"use client";
import { useState, type FormEvent } from "react";
import { visitor } from "./Tracking";
export function ContactForm() {
  const [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setStatus("");
    try {
      const data = Object.fromEntries(new FormData(form));
      const r = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, ...visitor() }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      setStatus("Thank you. Your enquiry has been received.");
      form.reset();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="contact-form" onSubmit={submit}>
      <h2>
        Let's talk about
        <br />
        <em>your car.</em>
      </h2>
      <label>
        Your name
        <input name="name" required autoComplete="name" />
      </label>
      <div className="form-pair">
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Phone (optional)
          <input name="phone" type="tel" autoComplete="tel" />
        </label>
      </div>
      <label>
        What can we help with?
        <textarea name="notes" required minLength={5} rows={4} />
      </label>
      <p className="fine-print">
        We use these details to respond to your enquiry. Read our{" "}
        <a href="/privacy-notice">privacy notice</a>.
      </p>
      <button disabled={busy} className="button">
        {busy ? "Sending..." : "Send enquiry"} ↗
      </button>
      {status && <p role="status">{status}</p>}
    </form>
  );
}
