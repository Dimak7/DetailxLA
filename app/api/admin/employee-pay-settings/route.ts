import { NextResponse } from "next/server";
import { requireSession } from "@/lib/platform/auth";
import { employeePaySettings } from "@/lib/platform/employee-pay-settings";
import { apiError } from "@/lib/platform/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireSession(request, "payroll");
    return NextResponse.json({ ok: true, ...await employeePaySettings(user) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
