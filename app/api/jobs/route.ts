import { NextResponse } from "next/server";
import { processOutbox } from "@/lib/platform/worker";
import { reconcileSquarePayments } from "@/lib/platform/square-jobs";
export async function POST(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get("authorization") !== "Bearer " + process.env.CRON_SECRET
  )
    return NextResponse.json({ ok: false }, { status: 401 });
  const [processed, square] = await Promise.all([processOutbox(50), reconcileSquarePayments()]);
  return NextResponse.json({ ok: true, processed, square });
}
