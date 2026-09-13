"use client";
import { useState } from "react";
export function SimpleAction({
  kind,
  values,
}: {
  kind: "review" | "unsubscribe";
  values: Record<string, string>;
}) {
  const [done, setDone] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return done ? (
    <div className="success-message" role="status">
      {kind === "review"
        ? "Thank you for sharing your experience."
        : "Your email marketing preference has been updated."}
    </div>
  ) : (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const f = new FormData(e.currentTarget);
        try {
          const r = await fetch("/api/" + kind, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...values,
              ...(kind === "review"
                ? { rating: Number(f.get("rating")), text: f.get("text") }
                : {}),
            }),
          });
          const d = await r.json();
          if (!r.ok) throw Error(d.error);
          setDone(true);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Please try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {kind === "review" && (
        <>
          <label className="field">
            <span>Your rating</span>
            <select name="rating" required>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} out of 5
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Your experience</span>
            <textarea name="text" minLength={5} maxLength={2000} required />
          </label>
          <p className="small-note">
            Your first name and feedback may be published on our website.
          </p>
        </>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <button className="button" disabled={busy}>
        {busy
          ? "Working..."
          : kind === "review"
            ? "Share feedback"
            : "Unsubscribe from marketing email"}
      </button>
    </form>
  );
}
