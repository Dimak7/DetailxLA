import { NextResponse } from "next/server";
import { requireSession } from "@/lib/platform/auth";
import { employeeJobHistory } from "@/lib/platform/employee-job-history";
import { apiError } from "@/lib/platform/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireSession(request, "payroll");
    const data = await employeeJobHistory(Object.fromEntries(new URL(request.url).searchParams), user);
    return NextResponse.json({ ok: true, ...data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
