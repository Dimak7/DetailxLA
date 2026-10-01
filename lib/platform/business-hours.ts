import type { BusinessSettings } from "./types";

type HoursSettings = Pick<BusinessSettings, "days" | "open_time" | "close_time" | "day_hours">;

export function businessHoursForDay(business: HoursSettings, weekday: number) {
  if (!business.days.includes(weekday)) return null;
  const override = business.day_hours.find((hours) => hours.weekday === weekday);
  return {
    open_time: override?.open_time ?? business.open_time,
    close_time: override?.close_time ?? business.close_time,
  };
}

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function openingHoursSpecification(business: HoursSettings) {
  return weekdays.flatMap((day, weekday) => {
    const hours = businessHoursForDay(business, weekday);
    return hours ? [{
      "@type": "OpeningHoursSpecification",
      dayOfWeek: day,
      opens: hours.open_time,
      closes: hours.close_time,
    }] : [];
  });
}
