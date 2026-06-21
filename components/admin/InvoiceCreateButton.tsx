"use client";

import { useState, type FormEvent } from "react";

export function InvoiceCreateButton({ bookingId, returnTo }: { bookingId: string; returnTo: string }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; paymentUrl?: string; warning?: boolean } | null>(null);

  async function createInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setResult(null);

    try {
      const response = await fetch("/api/admin/actions", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "X-Admin-Action": "fetch",
        },
        body: new FormData(event.currentTarget),
      });
      const data = await response.json().catch(() => null) as { success?: boolean; message?: string; error?: string; paymentUrl?: string; emailSent?: string } | null;

      if (!response.ok || !data?.success) {
        setResult({ success: false, message: data?.error || "Invoice could not be created." });
        return;
      }

      setResult({ success: true, warning: data.emailSent === "false", message: data.message || "Invoice created.", paymentUrl: data.paymentUrl });
    } catch (error) {
      setResult({ success: false, message: error instanceof Error ? error.message : "Invoice could not be created. Please try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-2" onSubmit={createInvoice}>
      <input type="hidden" name="action" value="create-invoice" />
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button className="w-full rounded-lg bg-red px-4 py-3 text-sm font-black uppercase text-white disabled:cursor-not-allowed disabled:bg-steel" disabled={pending} type="submit">
        {pending ? "Creating..." : "Create Invoice"}
      </button>
      {result ? (
        <div className={`rounded-lg px-3 py-3 text-xs font-black leading-5 ${result.success && !result.warning ? "bg-ink text-white" : "bg-red-soft text-ink"}`}>
          <p>{result.message}</p>
          {result.paymentUrl ? (
            <a className="mt-2 inline-flex uppercase underline" href={result.paymentUrl} rel="noreferrer" target="_blank">
              Open payment link
            </a>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
