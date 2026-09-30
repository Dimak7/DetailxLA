"use client";
import { useEffect, useRef, useState } from "react";
import { confirmedConversion } from "./Tracking";
import styles from "./BookingConfirmation.module.css";

export function ReceiptActions({ id, token, deposit, canPay, payments, resumeCheckoutUrl, onPaymentUncertain }: {
  id: string;
  token: string;
  deposit: boolean;
  canPay: boolean;
  payments: Array<{ id: string; amount_cents: number }>;
  resumeCheckoutUrl: string | null;
  onPaymentUncertain: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    setError("");
    payments.forEach((payment) => {
      try { confirmedConversion(payment.id, payment.amount_cents, "payment:" + payment.id, true); }
      catch { /* Privacy or analytics failures must not interrupt a receipt. */ }
    });
  }, [payments]);
  useEffect(() => () => {
    activeRequest.current?.abort();
    activeRequest.current = null;
  }, []);

  async function pay(kind: "deposit" | "balance") {
    if (activeRequest.current || !canPay) return;
    const request = new AbortController();
    activeRequest.current = request;
    setBusy(true);
    setError("");
    const timer = setTimeout(() => request.abort(), 25_000);
    try {
      const response = await fetch("/api/payment", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, token, kind }), signal: request.signal,
      });
      const body = await response.json();
      if (activeRequest.current !== request) return;
      if (!response.ok || typeof body.url !== "string" || !body.url) throw new Error("Checkout unavailable");
      window.location.assign(body.url);
    } catch {
      if (activeRequest.current !== request) return;
      setError("We couldn’t open checkout. Please check your payment status before trying again, or contact us for help.");
      setBusy(false);
      onPaymentUncertain();
    } finally {
      clearTimeout(timer);
      if (activeRequest.current === request) activeRequest.current = null;
    }
  }

  return <>
    {(canPay || resumeCheckoutUrl) && <div className={styles.actions}>
      {resumeCheckoutUrl ? <a className={styles.primaryButton} href={resumeCheckoutUrl}>Continue secure checkout</a> : <>
        {deposit && <button className={styles.primaryButton} disabled={busy} onClick={() => pay("deposit")}>{busy ? "Opening secure checkout…" : "Pay deposit securely"}</button>}
        <button className={deposit ? styles.secondaryButton : styles.primaryButton} disabled={busy} onClick={() => pay("balance")}>{busy ? "Opening secure checkout…" : deposit ? "Pay in full" : "Pay remaining balance"}</button>
      </>}
    </div>}
    {error && canPay && <p className={styles.notice} role="alert">{error}</p>}
  </>;
}
