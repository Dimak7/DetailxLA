import Link from "next/link";
import { Fragment } from "react";
import { AdminActionForm } from "@/components/admin/AdminActionForm";
import { AdminErrorBanner, AdminPageHeader, FlashMessage, StatusBadge } from "@/components/admin/AdminShell";
import { loadAdminData } from "@/lib/adminPageData";
import { getBookingDetails, addDays, getDateString } from "@/lib/adminData";
import { getAvailability, getNextTimeSlot, listBookingsByDate, listScheduleBlocks } from "@/lib/bookingStore";
import { isSlotWithinRange, timeSlots } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export default async function AdminSchedulePage({ searchParams }: { searchParams?: Promise<{ date?: string; view?: string; adminStatus?: string; adminMessage?: string }> }) {
  const params = await searchParams;
  const date = params?.date || getDateString(new Date());
  const view = params?.view === "day" ? "day" : "week";
  const dates = view === "week" ? Array.from({ length: 7 }, (_, index) => getDateString(addDays(new Date(`${date}T00:00:00`), index))) : [date];
  const scheduleState = await loadAdminData(
    "schedule view",
    () =>
      Promise.all(dates.map(async (scheduleDate) => ({
        date: scheduleDate,
        availability: await getAvailability(scheduleDate),
        bookings: await listBookingsByDate(scheduleDate),
        blocks: await listScheduleBlocks(scheduleDate),
      }))),
    dates.map((scheduleDate) => ({
      date: scheduleDate,
      availability: timeSlots.map((time) => ({ time, available: false as const, reason: undefined })),
      bookings: [],
      blocks: [],
    })),
    "Schedule data is temporarily unavailable. The error was logged on the server."
  );
  const schedule = scheduleState.data;

  return (
    <>
      <FlashMessage status={params?.adminStatus} message={params?.adminMessage} />
      <AdminErrorBanner message={scheduleState.error} />
      <AdminPageHeader
        eyebrow="Calendar"
        title="Schedule"
        copy="Week-first view of live bookings, open slots, and blocked time. Blocks and active bookings immediately affect public availability."
        action={<Link className="rounded-lg bg-red px-5 py-4 text-center font-black uppercase text-white" href="/admin/bookings">All Bookings</Link>}
      />
      <form className="mb-5 grid gap-3 rounded-lg bg-white p-4 ring-1 ring-ink/10 md:grid-cols-[1fr_1fr_auto]" action="/admin/schedule">
        <input className="admin-input" name="date" defaultValue={date} type="date" />
        <select className="admin-input" name="view" defaultValue={view}>
          <option value="week">Week view</option>
          <option value="day">Day view</option>
        </select>
        <button className="rounded-lg bg-ink px-5 py-3 font-black uppercase text-white" type="submit">Open</button>
      </form>

      <AdminActionForm className="mb-5 rounded-lg bg-ink p-4 text-white ring-1 ring-ink/10" pendingLabel="Blocking..." submitClassName="rounded-lg bg-red px-5 py-3 font-black uppercase text-white disabled:cursor-not-allowed disabled:opacity-60" submitLabel="Block Hours">
        <input type="hidden" name="action" value="block-slot" />
        <input type="hidden" name="returnTo" value={`/admin/schedule?date=${date}&view=${view}`} />
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_1.4fr_auto]">
          <select className="admin-input" name="date">
            {dates.map((scheduleDate) => <option key={scheduleDate} value={scheduleDate}>{scheduleDate}</option>)}
          </select>
          <select className="admin-input" name="startTime" defaultValue="10:00 AM">
            {timeSlots.map((time) => <option key={time} value={time}>Start {formatTime24(time)} / {time}</option>)}
          </select>
          <select className="admin-input" name="endTime" defaultValue="12:00 PM">
            {endTimeSlots.map((time) => <option key={time} value={time}>End {formatTime24(time)} / {time}</option>)}
          </select>
          <input className="admin-input" name="reason" placeholder="Reason, e.g. personal / unavailable" />
        </div>
      </AdminActionForm>

      <section className="overflow-x-auto rounded-lg bg-white shadow-sm ring-1 ring-ink/10">
        <div
          className="grid min-w-[1120px]"
          style={{ gridTemplateColumns: view === "week" ? "88px repeat(7,minmax(138px,1fr))" : "88px minmax(260px,1fr)" }}
        >
          <div className="sticky left-0 z-20 border-b border-r border-ink/10 bg-white p-3 text-xs font-black uppercase text-steel">Time</div>
          {schedule.map((day) => (
            <div className="border-b border-r border-ink/10 bg-smoke p-3" key={day.date}>
              <p className="text-xs font-black uppercase tracking-[0.08em] text-red">{formatWeekday(day.date)}</p>
              <p className="mt-1 font-black uppercase text-ink">{day.date}</p>
            </div>
          ))}

          {timeSlots.map((time) => (
            <Fragment key={time}>
              <div className="sticky left-0 z-10 border-b border-r border-ink/10 bg-white p-3">
                <p className="font-black uppercase text-ink">{formatTime24(time)}</p>
                <p className="mt-1 text-xs font-bold text-steel">{time}</p>
              </div>
              {schedule.map((day) => {
                const slot = day.availability.find((item) => item.time === time);
                const booking = day.bookings.find((item) => item.time === time && item.status !== "cancelled");
                const block = day.blocks.find((item) => isSlotWithinRange(time, item.startTime || item.time, item.endTime || getNextTimeSlot(item.time)));
                const services = booking ? getBookingDetails(booking).map((detail) => detail.service).join(" + ") : "";
                const isBlockStart = block ? time === (block.startTime || block.time) : false;

                return (
                  <div className="min-h-28 border-b border-r border-ink/10 bg-white p-2" key={`${day.date}-${time}`}>
                    {booking ? (
                      <Link className={`block h-full rounded-lg p-3 ${getBookingBlockClass(booking.status)}`} href={`/admin/bookings?search=${encodeURIComponent(booking.email)}`}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-black uppercase leading-tight">{booking.name}</p>
                          <StatusBadge status={booking.status} />
                        </div>
                        <p className="mt-2 text-xs font-black uppercase">{time}</p>
                        {booking.carModel ? <p className="mt-1 text-[11px] font-bold uppercase opacity-80">{booking.carModel}</p> : null}
                        <p className="mt-1 text-xs font-bold leading-5 opacity-80">{services}</p>
                      </Link>
                    ) : block ? (
                      <div className="h-full rounded-lg bg-ink p-3 text-white">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-black uppercase">Blocked</p>
                          <StatusBadge status="blocked" />
                        </div>
                        <p className="mt-2 text-xs font-black uppercase text-red-soft">{block.startTime || block.time} - {block.endTime || getNextTimeSlot(block.time)}</p>
                        <p className="mt-2 text-xs font-bold text-ash">{block.reason}</p>
                        {isBlockStart ? (
                          <AdminActionForm className="mt-3" pendingLabel="Removing..." refreshOnSuccess submitClassName="text-xs font-black uppercase text-red-soft disabled:cursor-not-allowed disabled:opacity-60" submitLabel="Remove">
                            <input type="hidden" name="action" value="remove-block" />
                            <input type="hidden" name="blockId" value={block.id} />
                            <input type="hidden" name="returnTo" value={`/admin/schedule?date=${date}&view=${view}`} />
                          </AdminActionForm>
                        ) : null}
                      </div>
                    ) : (
                      <div className="grid h-full place-items-center rounded-lg bg-smoke text-center">
                        <span className={`text-xs font-black uppercase ${slot?.available ? "text-steel" : "text-red"}`}>{slot?.available ? "Open" : slot?.reason || "Unavailable"}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-lg bg-white p-4 shadow-sm ring-1 ring-ink/10">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.12em] text-red">Unavailable Hours</p>
            <h2 className="mt-1 text-2xl font-black uppercase text-ink">Blocked time manager</h2>
          </div>
          <p className="max-w-xl text-sm font-bold leading-6 text-steel">Edit or remove phone bookings, personal time, and other unavailable windows. These blocks are used by the public booking calendar immediately.</p>
        </div>
        <div className="mt-4 grid gap-3">
          {schedule.flatMap((day) => day.blocks.map((block) => ({ ...block, date: day.date }))).length ? (
            schedule.flatMap((day) => day.blocks.map((block) => (
              <AdminActionForm className="rounded-lg bg-smoke p-3" key={block.id} pendingLabel="Saving..." submitClassName="rounded-lg bg-ink px-4 py-3 text-xs font-black uppercase text-white disabled:cursor-not-allowed disabled:opacity-60" submitLabel="Save">
                <input type="hidden" name="action" value="update-block" />
                <input type="hidden" name="blockId" value={block.id} />
                <input type="hidden" name="returnTo" value={`/admin/schedule?date=${date}&view=${view}`} />
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_1.3fr_auto]">
                  <input className="admin-input" name="date" type="date" defaultValue={day.date} />
                  <select className="admin-input" name="startTime" defaultValue={block.startTime || block.time}>
                    {timeSlots.map((time) => <option key={time} value={time}>{formatTime24(time)} / {time}</option>)}
                  </select>
                  <select className="admin-input" name="endTime" defaultValue={block.endTime || getNextTimeSlot(block.time)}>
                    {endTimeSlots.map((time) => <option key={time} value={time}>{formatTime24(time)} / {time}</option>)}
                  </select>
                  <input className="admin-input" name="reason" defaultValue={block.reason} />
                </div>
              </AdminActionForm>
            )))
          ) : (
            <div className="rounded-lg bg-smoke p-4 text-sm font-bold text-steel">No blocked hours in this view.</div>
          )}
        </div>
      </section>
    </>
  );
}

const endTimeSlots = [...timeSlots.slice(1), "8:00 PM"] as const;

function formatTime24(time: string) {
  const match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) {
    return time;
  }

  let hour = Number(match[1]);
  const minute = match[2];
  const period = match[3].toUpperCase();

  if (period === "PM" && hour !== 12) {
    hour += 12;
  }

  if (period === "AM" && hour === 12) {
    hour = 0;
  }

  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function formatWeekday(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
}

function getBookingBlockClass(status: string) {
  if (status === "confirmed") {
    return "bg-ink text-white";
  }

  if (status === "completed") {
    return "bg-green-100 text-green-950";
  }

  return "bg-red-soft text-ink";
}
