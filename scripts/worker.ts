import { processMetaLeads } from "../lib/integrations/meta-leads";
import { processOutbox } from "../lib/platform/worker";
import { reconcileSquarePayments } from "../lib/platform/square-jobs";
async function main() {
  for (;;) {
    await processMetaLeads().catch(() => console.error("Meta lead import retry failed."));
    await processOutbox().catch((error) =>
      console.error(
        "Worker error",
        error instanceof Error ? error.message : "Unknown",
      ),
    );
    await reconcileSquarePayments().catch(() =>
      console.error("Square reconciliation failed; check the dashboard sync status."),
    );
    await new Promise((resolve) => setTimeout(resolve, 15000));
  }
}
void main();
