import { addDays, eachDayOfInterval, format, parseISO } from "date-fns";
import type { AudioAPeriod, DailyWorkAssignment } from "./domain";
import { getAudioShift } from "./rotation";

export type AudioRotationSetting = {
  employeeId: string;
  employeeName: string;
  audioIndex: number;
  startDate?: string;
  startShift?: "A" | "U";
};

export function isSameWorkBlock(first: DailyWorkAssignment, second: DailyWorkAssignment | undefined) {
  return Boolean(
    second
    && first.employeeId === second.employeeId
    && first.shift === second.shift
    && first.start === second.start
    && first.end === second.end,
  );
}

export function buildAudioAPeriods(
  rangeStart: string,
  rangeEnd: string,
  settings: AudioRotationSetting[],
  excludedMonths: Iterable<string> = [],
): AudioAPeriod[] {
  const periods: AudioAPeriod[] = [];
  const excluded = new Set(excludedMonths);

  for (const setting of settings) {
    let activeStart: string | undefined;
    const days = eachDayOfInterval({ start: parseISO(rangeStart), end: parseISO(rangeEnd) });

    for (const day of days) {
      const date = format(day, "yyyy-MM-dd");
      const isA = !excluded.has(date.slice(0, 7)) && getAudioShift(date, setting.audioIndex, setting.startDate, setting.startShift) === "A";
      if (isA && !activeStart) activeStart = date;
      if (!isA && activeStart) {
        periods.push({
          employeeId: setting.employeeId,
          employeeName: setting.employeeName,
          startDate: activeStart,
          endDate: format(addDays(day, -1), "yyyy-MM-dd"),
        });
        activeStart = undefined;
      }
    }

    if (activeStart) {
      periods.push({
        employeeId: setting.employeeId,
        employeeName: setting.employeeName,
        startDate: activeStart,
        endDate: rangeEnd,
      });
    }
  }

  return periods.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.employeeName.localeCompare(b.employeeName));
}
