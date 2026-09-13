import { NextResponse, after } from "next/server";
import { query, transaction } from "@/lib/platform/db";
import { settings } from "@/lib/platform/settings";
import { enqueue } from "@/lib/platform/outbox";
import { processOutbox } from "@/lib/platform/worker";
import { dateToday, timeLabel } from "@/lib/platform/types";
export async function POST(req: Request) {
  if (
    !process.env.CRON_SECRET ||
    req.headers.get("authorization") !== "Bearer " + process.env.CRON_SECRET
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await settings(),
    date = dateToday();
  const appointments = await query<{
    name: string;
    service_name: string;
    start_minute: number;
  }>(
    "SELECT c.first_name||' '||c.last_name name,b.service_name,b.start_minute FROM wl.bookings b JOIN wl.customers c ON c.id=b.customer_id WHERE booking_date=$1 AND status NOT IN ('cancelled','no_show') ORDER BY start_minute",
    [date],
  );
  await transaction((q) =>
    enqueue(q, {
      key: "daily-schedule:" + date,
      channel: "telegram",
      recipient: b.telegram_chat_id,
      body:
        "Today's appointments · " +
        date +
        "\n" +
        (appointments
          .map(
            (a) =>
              timeLabel(a.start_minute) + " " + a.name + " · " + a.service_name,
          )
          .join("\n") || "No appointments."),
    }),
  );
  after(() =>
    processOutbox(10)
      .then(() => {})
      .catch(() => {}),
  );
  return NextResponse.json({ ok: true });
}
