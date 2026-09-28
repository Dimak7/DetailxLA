"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { money } from "@/lib/platform/types";
import type { squareRevenueStatus } from "@/lib/integrations/square-reporting";
import type { report } from "@/lib/platform/reporting";
import styles from "./SquareRevenue.module.css";

type SquareStatus = Awaited<ReturnType<typeof squareRevenueStatus>>;
type SquareSummary = Awaited<ReturnType<typeof report>>["square"];

export function SquareRevenue({ connection, summary }: {
  connection: SquareStatus;
  summary?: SquareSummary;
}) {
  const router = useRouter();
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const { configured, environment } = connection;

  const synchronize = useCallback(async () => {
    if (!configured || request.current || document.visibilityState !== "visible") return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      let hasMore = true;
      while (hasMore && !controller.signal.aborted && document.visibilityState === "visible") {
        const response = await fetch("/api/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sync_square_payments", data: {} }),
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Square payments could not be synchronized.");
        const result = data.result;
        if (result.busy) {
          setMessage("Square is syncing in the background. Totals refresh automatically.");
          break;
        }
        hasMore = Boolean(result.hasMore);
        setMessage(hasMore
          ? `Importing Square history… ${Number(result.count || 0).toLocaleString()} payment records available.`
          : "Square payments are up to date.");
        router.refresh();
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Square sync failed. Please try again.");
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }, [configured, environment, router]);

  useEffect(() => {
    void synchronize();
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const resume = () => { refresh(); void synchronize(); };
    const refreshTimer = window.setInterval(refresh, 30_000);
    const syncTimer = window.setInterval(() => void synchronize(), 300_000);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(refreshTimer);
      window.clearInterval(syncTimer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", refresh);
      request.current?.abort();
      request.current = null;
    };
  }, [router, synchronize]);

  return <section className={`paper ${styles.panel}`} aria-labelledby="square-revenue-title">
    <div className={styles.heading}>
      <div><p className="eyebrow">ALL SQUARE LOCATIONS</p><h2 id="square-revenue-title">Square collections</h2></div>
      <button className={`button ${styles.syncButton}`} type="button" disabled={busy || !configured} onClick={() => void synchronize()}>
        {busy ? "Syncing Square…" : "Sync Square payments"}
      </button>
    </div>
    <p className="small-note">Card reader, in-person, and online payments are included. Completed USD payments contribute to revenue once, less refunds, using the original payment date.</p>
    {!configured && <p role="status">Connect a Square access token in Settings to import your payment history.</p>}
    {environment === "sandbox" && <p role="status"><strong>Sandbox connection:</strong> test payments are excluded from revenue. Connect production Square credentials to import real collections.</p>}
    {summary && <div className={styles.metrics}>
      {[
        ["Square net collections", money(summary.net), `${summary.transaction_count} completed payments in this period`],
        ["Square refunds", money(summary.refunds), "Refunds on payments in this period"],
        ["Square tips", money(summary.tips), "Included in collected amounts"],
        ["Square processing fees", money(summary.fees), "Reported by Square; shown separately from collections"],
      ].map(([label, value, hint]) => <div className={`stat ${styles.metric}`} key={label}><p>{label}</p><strong>{value}</strong><small>{hint}</small></div>)}
    </div>}
    {summary && summary.unlinked_transaction_count > 0 && <p className="small-note">{money(summary.unlinked_total)} from {summary.unlinked_transaction_count} Square payments without a website appointment is included in revenue. These payments do not affect website booking conversion or customer averages.</p>}
    <p className="small-note">{connection.lastSyncedAt
      ? `Last completed sync: ${new Date(connection.lastSyncedAt).toLocaleString("en-US", { timeZone: "America/Chicago" })} Central Time.`
      : "Historical sync has not completed yet; totals may be incomplete."} {connection.hasMore ? "More payment history is being imported." : ""}</p>
    <p className="small-note" role="status" aria-live="polite">{message}</p>
    {(error || connection.lastError) && <p role="alert">{error || connection.lastError}</p>}
    {summary && <Link className="text-link" href="/admin/payments">Review Square transactions</Link>}
  </section>;
}
