import { NextResponse } from "next/server";
import { assertFutureDate } from "@/lib/bookingSchema";
import { getAvailability } from "@/lib/bookingStore";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") || "";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: "Choose a valid date." }, { status: 400 });
  }

  try {
    assertFutureDate(date);
    return NextResponse.json({ ok: true, date, slots: await getAvailability(date) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not load availability." },
      { status: 400 }
    );
  }
}
