import { NextResponse, after } from "next/server";
import { createBooking } from "@/lib/platform/bookings";
import { rateLimit, assertOrigin, requestIP } from "@/lib/platform/auth";
import { apiError, readJson } from "@/lib/platform/http";
import { processOutbox } from "@/lib/platform/worker";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    await rateLimit("booking:" + requestIP(request), 15, 900);
    const result = await createBooking(await readJson(request));
    after(() =>
      processOutbox(10)
        .then(() => {})
        .catch(() => {}),
    );
    const b = result.booking;
    return NextResponse.json(
      {
        ok: true,
        booking_id: b.id,
        reference: b.reference,
        value_cents: b.price_cents,
        deposit_cents: b.deposit_cents,
        currency: "USD",
        event_id: result.event_id,
        confirmation_url:
          "/booking/confirmation?id=" + b.id + "&token=" + result.token,
      },
      { status: 201 },
    );
  } catch (e) {
    return apiError(e);
  }
}
