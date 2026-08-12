import { getHolidays, hasYear, type HolidayEntry } from "@hangukit/holidays-core";

export type CalendarHoliday = Pick<HolidayEntry, "date" | "name" | "kind">;

export function getCalendarHolidays(month: string): CalendarHoliday[] {
  const year = Number(month.slice(0, 4));
  return [year - 1, year, year + 1]
    .filter((candidate) => hasYear(candidate))
    .flatMap((candidate) => getHolidays(candidate));
}
