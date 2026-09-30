import type { BookingReceipt } from "@/lib/platform/receipts";
import { needsPaymentVerification } from "./booking-confirmation-state";

type PollOptions = {
  id: string;
  token: string;
  returned: boolean;
  signal: AbortSignal;
  onReceipt: (receipt: BookingReceipt, verificationUnavailable: boolean) => void;
  onUnavailable: () => void;
  fetcher?: typeof fetch;
  now?: () => number;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  durationMs?: number;
  requestTimeoutMs?: number;
  intervalMs?: number;
};

function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** One request at a time, with a total deadline and abortable requests and waits. */
export async function pollBookingStatus(options: PollOptions): Promise<"settled" | "timeout" | "aborted"> {
  const { id, token, returned, signal, onReceipt, onUnavailable } = options;
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? delay;
  const deadline = now() + (options.durationMs ?? 30_000);
  while (!signal.aborted && now() < deadline) {
    const request = new AbortController();
    const abortRequest = () => request.abort();
    signal.addEventListener("abort", abortRequest, { once: true });
    const timer = setTimeout(abortRequest, Math.min(options.requestTimeoutMs ?? 25_000, deadline - now()));
    try {
      const response = await fetcher("/api/booking/status", {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, token }), signal: request.signal,
      });
      if (!response.ok) throw new Error("Status unavailable");
      const body = await response.json() as { ok?: boolean; receipt?: BookingReceipt; verificationUnavailable?: boolean };
      if (!body.ok || !body.receipt || body.receipt.id !== id) throw new Error("Status unavailable");
      if (signal.aborted || request.signal.aborted) {
        if (signal.aborted) return "aborted";
        throw new Error("Status unavailable");
      }
      onReceipt(body.receipt, body.verificationUnavailable === true);
      if (!needsPaymentVerification(body.receipt, returned) || (!returned && !body.verificationUnavailable)) return "settled";
    } catch {
      if (signal.aborted) return "aborted";
      onUnavailable();
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abortRequest);
    }
    if (!signal.aborted && now() < deadline) {
      await wait(Math.min(options.intervalMs ?? 2_500, deadline - now()), signal);
    }
  }
  return signal.aborted ? "aborted" : "timeout";
}
