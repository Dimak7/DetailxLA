import { NextResponse } from "next/server";
import { processOutbox } from "@/lib/platform/worker";
export async function POST(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get("authorization") !== "Bearer " + process.env.CRON_SECRET
  )
    return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, processed: await processOutbox(50) });
}
