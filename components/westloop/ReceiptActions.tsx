"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmedConversion } from "./Tracking";
export function ReceiptActions({
  id,
  token,
  deposit,
  canPay,
  payments,
}: {
  id: string;
  token: string;
  deposit: boolean;
  canPay: boolean;
  payments: Array<{ id: string; amount_cents: number }>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  useEffect(() => {
    payments.forEach((p) =>
      confirmedConversion(p.id, p.amount_cents, "payment:" + p.id, true),
    );
  }, [payments]);
  async function pay(kind: string) {
    setBusy(true);
    try {
      const r = await fetch("/api/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, token, kind }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      location.assign(d.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment is unavailable.");
      setBusy(false);
    }
  }
  return (
    <>
      {canPay && (
        <div className="button-row">
          {deposit && (
            <button
              className="button"
              disabled={busy}
              onClick={() => pay("deposit")}
            >
              Pay deposit securely ↗
            </button>
          )}
          <button
            className={deposit ? "button outline" : "button"}
            disabled={busy}
            onClick={() => pay("balance")}
          >
            Pay balance ↗
          </button>
        </div>
      )}
      <button className="link-button" onClick={() => router.refresh()}>
        Refresh payment status
      </button>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
