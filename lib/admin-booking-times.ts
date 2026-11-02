export type AdminBookingTime = { minute: number; available: boolean };

/** A cancelled date/service lookup must never replace the current schedule. */
export async function loadAdminBookingTimes(
  query: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<AdminBookingTime[] | null> {
  const response = await fetcher(`/api/admin/booking-availability?${query}`, { signal, cache: "no-store" });
  const result = await response.json();
  if (signal.aborted) return null;
  if (!response.ok || result?.ok === false) throw new Error(result?.error || "Could not check the schedule. Try again.");
  if (!Array.isArray(result?.slots) || !result.slots.every((slot: AdminBookingTime) =>
    slot && Number.isInteger(slot.minute) && slot.minute >= 0 && slot.minute < 1440 && typeof slot.available === "boolean",
  )) throw new Error("Could not read the available times. Try again.");
  return result.slots;
}

/** Walk-ins may choose an earlier free time, but default to the next free slot. */
export function nextAdminBookingTime(slots: AdminBookingTime[], minute: number) {
  const nextHalfHour = Math.ceil(minute / 30) * 30;
  return slots.find(slot => slot.available && slot.minute >= nextHalfHour)?.minute ?? -1;
}
