"use client";

import { FormEvent, useState } from "react";

type LoginStatus = {
  type: "idle" | "error";
  message: string;
};

export function AdminLoginForm() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<LoginStatus>({ type: "idle", message: "" });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ type: "idle", message: "" });

    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");

    if (!email || !password) {
      setStatus({ type: "error", message: "Enter your admin email and password." });
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Could not sign in to the admin portal.");
      }

      window.location.assign(result.redirectTo || "/admin/dashboard");
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Could not sign in to the admin portal.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
      <label className="grid gap-2 text-xs font-black uppercase tracking-[0.12em] text-ash">
        Email
        <input
          className="min-h-12 rounded-lg border border-white/15 bg-white px-4 text-ink outline-none transition focus:border-red focus:ring-4 focus:ring-red/20"
          name="email"
          type="email"
          autoComplete="username"
          required
          disabled={loading}
        />
      </label>
      <label className="grid gap-2 text-xs font-black uppercase tracking-[0.12em] text-ash">
        Password
        <input
          className="min-h-12 rounded-lg border border-white/15 bg-white px-4 text-ink outline-none transition focus:border-red focus:ring-4 focus:ring-red/20"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={loading}
        />
      </label>
      <button
        className="rounded-lg bg-red px-5 py-4 font-black uppercase text-white transition hover:bg-red-dark disabled:cursor-wait disabled:opacity-70"
        type="submit"
        disabled={loading}
      >
        {loading ? "Signing in..." : "Sign In"}
      </button>
      {status.message ? <p className="rounded-lg bg-red-soft px-4 py-3 text-sm font-black text-ink">{status.message}</p> : null}
    </form>
  );
}
