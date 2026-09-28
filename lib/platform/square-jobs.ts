import { squareRevenueStatus, syncSquarePayments } from "../integrations/square-reporting";
import { query } from "./db";

/** Reconcile missed webhooks without delaying reports or customer-facing requests. */
export async function reconcileSquarePayments() {
  const state = await squareRevenueStatus();
  if (!state.configured) return { skipped: true };
  const [lastRun] = await query<{ updated_at: string | Date }>(
    "SELECT updated_at FROM wl.square_sync WHERE environment=$1",
    [state.environment],
  );
  const age = lastRun ? Date.now() - new Date(lastRun.updated_at).getTime() : Infinity;
  if ((state.status === "error" && age < 300_000) ||
      (!state.hasMore && state.lastSyncedAt && Date.now() - new Date(state.lastSyncedAt).getTime() < 300_000))
    return { skipped: true };
  try {
    return await syncSquarePayments();
  } catch {
    // The sync stores a safe, actionable error for the authenticated dashboard.
    return { error: "Square sync needs attention in the dashboard." };
  }
}
