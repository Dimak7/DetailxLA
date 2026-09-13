import { processOutbox } from "../lib/platform/worker";
async function main() {
  for (;;) {
    await processOutbox().catch((error) =>
      console.error(
        "Worker error",
        error instanceof Error ? error.message : "Unknown",
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 15000));
  }
}
void main();
