import { NextResponse, after } from "next/server";
import {
  verifySquareEvent,
  handleSquareEvent,
} from "@/lib/integrations/payments";
import { apiError } from "@/lib/platform/http";
import { processOutbox } from "@/lib/platform/worker";

export async function POST(request: Request) {
  try {
    const body = await request.text();
    await handleSquareEvent(
      await verifySquareEvent(
        body,
        request.headers.get("x-square-hmacsha256-signature") || "",
      ),
    );
    after(() =>
      processOutbox(10)
        .then(() => {})
        .catch(() => {}),
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

