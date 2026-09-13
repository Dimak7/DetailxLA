import { NextResponse } from "next/server";
import { availability } from "@/lib/platform/bookings";
import { apiError } from "@/lib/platform/http";
import { z } from "zod";
export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    return NextResponse.json({
      ok: true,
      slots: await availability(
        p.get("date") || "",
        z.uuid().parse(p.get("service_id")),
      ),
    });
  } catch (e) {
    return apiError(e);
  }
}
