export const timeSlots = [
  "6:00 AM",
  "7:00 AM",
  "8:00 AM",
  "9:00 AM",
  "10:00 AM",
  "11:00 AM",
  "12:00 PM",
  "1:00 PM",
  "2:00 PM",
  "3:00 PM",
  "4:00 PM",
  "5:00 PM",
  "6:00 PM",
  "7:00 PM",
] as const;

export type TimeSlot = (typeof timeSlots)[number];

export type SlotAvailability = {
  time: TimeSlot;
  available: boolean;
  reason?: "booked" | "blocked";
};

export function isTimeSlot(value: string): value is TimeSlot {
  return timeSlots.includes(value as TimeSlot);
}

export function parseTimeSlotToMinutes(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3].toUpperCase();

  if (period === "PM" && hour !== 12) {
    hour += 12;
  }

  if (period === "AM" && hour === 12) {
    hour = 0;
  }

  return hour * 60 + minute;
}

export function formatMinutesToTime(value: number) {
  const normalized = ((value % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

export function addHoursToTimeSlot(time: string, hours: number) {
  const minutes = parseTimeSlotToMinutes(time);

  if (minutes === null) {
    return time;
  }

  return formatMinutesToTime(minutes + Math.max(0, hours) * 60);
}

export function isSlotWithinRange(slot: string, startTime: string, endTime: string) {
  const slotMinutes = parseTimeSlotToMinutes(slot);
  const startMinutes = parseTimeSlotToMinutes(startTime);
  const endMinutes = parseTimeSlotToMinutes(endTime);

  if (slotMinutes === null || startMinutes === null || endMinutes === null) {
    return false;
  }

  return slotMinutes >= startMinutes && slotMinutes < endMinutes;
}

export function doTimeRangesOverlap(firstStart: string, firstEnd: string, secondStart: string, secondEnd: string) {
  const firstStartMinutes = parseTimeSlotToMinutes(firstStart);
  const firstEndMinutes = parseTimeSlotToMinutes(firstEnd);
  const secondStartMinutes = parseTimeSlotToMinutes(secondStart);
  const secondEndMinutes = parseTimeSlotToMinutes(secondEnd);

  if (firstStartMinutes === null || firstEndMinutes === null || secondStartMinutes === null || secondEndMinutes === null) {
    return false;
  }

  return firstStartMinutes < secondEndMinutes && secondStartMinutes < firstEndMinutes;
}

export function assertTimeRange(startTime: string, endTime: string) {
  if (!isTimeSlot(startTime) || parseTimeSlotToMinutes(endTime) === null) {
    throw new Error("Choose valid start and end times.");
  }

  const startMinutes = parseTimeSlotToMinutes(startTime);
  const endMinutes = parseTimeSlotToMinutes(endTime);

  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    throw new Error("End time must be after start time.");
  }
}
