import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/platform/auth";
import { availability } from "@/lib/platform/bookings";
import { apiError } from "@/lib/platform/http";

export async function GET(request: Request) {
  try {
    await requireSession(request, "bookings");
    const params = new URL(request.url).searchParams;
    const serviceIds = z.array(z.uuid()).min(1).max(12).parse(params.getAll("service_id"));
    const options = z.object({
      walk_in: z.enum(["true", "false"]).transform(value => value === "true"),
      duration_minutes: z.coerce.number().int().min(30).max(720).optional(),
    }).parse({ walk_in: params.get("walk_in") || "false", ...(params.has("duration_minutes") ? { duration_minutes: params.get("duration_minutes") } : {}) });
    return NextResponse.json({ ok: true, slots: await availability(params.get("date") || "", serviceIds, undefined, options) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
