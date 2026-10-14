import { NextResponse } from "next/server";
import { z } from "zod";
import { assertOrigin, requireSession } from "@/lib/platform/auth";
import { query } from "@/lib/platform/db";
import { apiError, readJson } from "@/lib/platform/http";
import { marketingCommissionRows, marketingCommissionAction } from "@/lib/platform/marketing-commissions";
export async function GET(request: Request) {
  try {
    await requireSession(request, "marketing");
    return NextResponse.json({ rows: await marketingCommissionRows(), payouts: await query("SELECT p.id,p.amount_cents,p.reference,p.created_at,b.reference booking_reference,u.name recorded_by FROM wl.marketing_commission_payouts p JOIN wl.bookings b ON b.id=p.booking_id JOIN wl.users u ON u.id=p.recorded_by ORDER BY p.created_at DESC LIMIT 100") }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return apiError(e); }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const user = await requireSession(request, "marketing");
    const data = z.object({ booking_id: z.uuid(), action: z.enum(["approve","record_paid"]), reference: z.string().trim().max(240).default(""), verified_service_subtotal: z.literal(true) }).parse(await readJson(request));
    return NextResponse.json(await marketingCommissionAction(data.booking_id,user.user_id,data.action,data.reference));
  } catch (e) { return apiError(e); }
}
