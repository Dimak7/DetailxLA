"use client";
import { useState } from "react";
import Link from "next/link";
import { Wordmark } from "./PublicShell";
export function LoginForm({ token = "" }: { token?: string }) {
  const [reset, setReset] = useState(!!token),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main id="main" className="login-wrap">
      <div className="login-card">
        <Link href="/">
          <Wordmark />
        </Link>
        <p className="eyebrow">BUSINESS WORKSPACE</p>
        <h1>{reset ? "A fresh start." : "Welcome back."}</h1>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            try {
              const r = await fetch(
                reset ? "/api/admin/reset" : "/api/admin/login",
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    email: f.get("email"),
                    password: f.get("password"),
                    ...(token ? { token } : {}),
                  }),
                },
              );
              const d = await r.json();
              if (!r.ok) throw Error(d.error);
              if (!reset) {
                location.assign(d.redirectTo);
                return;
              }
              setMessage(
                token
                  ? "Your password has been changed. You can sign in now."
                  : d.message,
              );
            } catch (e) {
              setError(e instanceof Error ? e.message : "Please try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {!token && (
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                name="email"
                autoComplete="username"
                required
              />
            </label>
          )}
          {(!reset || token) && (
            <label className="field">
              <span>
                {token ? "New password (12+ characters)" : "Password"}
              </span>
              <input
                type="password"
                name="password"
                autoComplete={token ? "new-password" : "current-password"}
                required
                minLength={token ? 12 : undefined}
                maxLength={128}
              />
            </label>
          )}
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="success-message" role="status">
              {message}
            </p>
          )}
          <button className="button" disabled={busy}>
            {busy ? "Please wait..." : reset ? "Reset password" : "Sign in ↗"}
          </button>
        </form>
        {token ? (
          <Link href="/admin/login" className="text-link">
            Back to sign in
          </Link>
        ) : (
          <button
            className="link-button"
            onClick={() => {
              setReset(!reset);
              setError("");
              setMessage("");
            }}
          >
            {reset ? "Back to sign in" : "Forgot your password?"}
          </button>
        )}
        <p className="small-note">
          Authorized team members only. Initial owner access is configured
          securely on the server.
        </p>
      </div>
    </main>
  );
}
