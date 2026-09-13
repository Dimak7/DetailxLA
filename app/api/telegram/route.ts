import { NextResponse, after } from "next/server";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { query, transaction } from "@/lib/platform/db";
import { settings, secret } from "@/lib/platform/settings";
import { enqueue } from "@/lib/platform/outbox";
import { processOutbox } from "@/lib/platform/worker";
import { dateToday, timeLabel } from "@/lib/platform/types";
import { apiError, readJson } from "@/lib/platform/http";
import { AppError } from "@/lib/platform/auth";
export async function POST(request: Request) {
  try {
    const expected = await secret("telegram_webhook"),
      given = request.headers.get("x-telegram-bot-api-secret-token") || "";
    if (
      !expected ||
      expected.length !== given.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(given))
    )
      throw new AppError("Unauthorized", 401);
    const update = await readJson(request),
      b = await settings();
    if (String(update.message?.chat?.id) !== b.telegram_chat_id)
      return NextResponse.json({ ok: true });
    const text = String(update.message?.text || ""),
      date = dateToday(
        new Date(Date.now() + (text.startsWith("/tomorrow") ? 86400000 : 0)),
      );
    const appointments = await query<{
      reference: string;
      service_name: string;
      start_minute: number;
      name: string;
      status: string;
    }>(
      "SELECT b.reference,b.service_name,b.start_minute,b.status,c.first_name||' '||c.last_name name FROM wl.bookings b JOIN wl.customers c ON c.id=b.customer_id WHERE booking_date=$1 AND status NOT IN ('cancelled','no_show') ORDER BY start_minute",
      [date],
    );
    const body = [
      "West Loop Auto Spa · " + date,
      ...appointments.map(
        (a) =>
          timeLabel(a.start_minute) +
          " · " +
          a.name +
          " · " +
          a.service_name +
          " · " +
          a.status,
      ),
      appointments.length ? "" : "No appointments.",
      "Use /today or /tomorrow. Manage appointments securely in the workspace.",
    ]
      .filter(Boolean)
      .join("\n");
    await transaction((q) =>
      enqueue(q, {
        key: "telegram-command:" + String(update.update_id || randomUUID()),
        channel: "telegram",
        recipient: b.telegram_chat_id,
        body,
      }),
    );
    after(() =>
      processOutbox(5)
        .then(() => {})
        .catch(() => {}),
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
