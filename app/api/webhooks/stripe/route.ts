import { NextResponse, after } from "next/server";
import {
  verifyStripeEvent,
  handleStripeEvent,
} from "@/lib/integrations/payments";
import { apiError } from "@/lib/platform/http";
import { processOutbox } from "@/lib/platform/worker";
export async function POST(request: Request) {
  try {
    await handleStripeEvent(
      await verifyStripeEvent(
        await request.text(),
        request.headers.get("stripe-signature") || "",
      ),
    );
    after(() =>
      processOutbox(10)
        .then(() => {})
        .catch(() => {}),
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
