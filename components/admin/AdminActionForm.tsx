"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

export function AdminActionForm({
  action = "/api/admin/actions",
  className,
  children,
  pendingLabel = "Saving...",
  refreshOnSuccess = true,
  submitClassName,
  submitLabel = "Save",
}: {
  action?: string;
  className?: string;
  children: ReactNode;
  pendingLabel?: string;
  refreshOnSuccess?: boolean;
  submitClassName?: string;
  submitLabel?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setResult(null);

    try {
      const response = await fetch(action, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "X-Admin-Action": "fetch",
        },
        body: new FormData(event.currentTarget),
      });

      const data = await response.json().catch(() => null) as { success?: boolean; message?: string; error?: string } | null;
      if (!response.ok || !data?.success) {
        setResult({ success: false, message: data?.error || "Admin action could not be completed." });
        return;
      }

      setResult({ success: true, message: data.message || "Admin update saved." });
      if (refreshOnSuccess) {
        router.refresh();
      }
    } catch (error) {
      setResult({
        success: false,
        message: error instanceof Error ? error.message : "Admin action could not be completed. Please try again.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={action} className={className} method="post" onSubmit={handleSubmit}>
      <fieldset className="grid gap-3" disabled={pending}>
        {children}
        <button className={submitClassName || "rounded-lg bg-ink px-4 py-3 text-sm font-black uppercase text-white disabled:cursor-not-allowed disabled:opacity-60"} type="submit">
          {pending ? pendingLabel : submitLabel}
        </button>
      </fieldset>
      {result ? (
        <p className={`rounded-lg px-3 py-3 text-xs font-black leading-5 ${result.success ? "bg-ink text-white" : "bg-red-soft text-ink"}`}>
          {result.message}
        </p>
      ) : null}
    </form>
  );
}
