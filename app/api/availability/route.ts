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
        z.array(z.uuid()).min(1).max(12).parse(p.getAll("service_id")),
      ),
    });
  } catch (e) {
    return apiError(e);
  }
}
