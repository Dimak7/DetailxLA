import { NextResponse } from "next/server";
import { requireSession } from "@/lib/platform/auth";
import { apiError, readJson } from "@/lib/platform/http";
import { setCustomerArchived } from "@/lib/platform/customer-archive";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const user = await requireSession(request, "customers");
    return NextResponse.json(await setCustomerArchived(user, await readJson(request)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
