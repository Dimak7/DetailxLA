import { NextResponse } from "next/server";
import { sendDailyTelegramSchedule } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleDailyScheduleRequest(request);
}

export async function POST(request: Request) {
  return handleDailyScheduleRequest(request);
}

async function handleDailyScheduleRequest(request: Request) {
  const secret = process.env.CRON_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET;

  if (secret) {
    const url = new URL(request.url);
    const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || url.searchParams.get("secret");

    if (provided !== secret) {
      return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
    }
  }

  const result = await sendDailyTelegramSchedule();
  return NextResponse.json({ ok: result === "sent", status: result });
}
