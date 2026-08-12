import { describe, expect, it } from "vitest";
import { getCalendarHolidays } from "./korean-holidays";

describe("대한민국 공휴일", () => {
  const holidays = getCalendarHolidays("2026-02");

  it("설날 연휴 3일을 모두 포함한다", () => {
    expect(holidays.filter((holiday) => holiday.name === "설날" && holiday.date.startsWith("2026-")).map((holiday) => holiday.date)).toEqual([
      "2026-02-16", "2026-02-17", "2026-02-18",
    ]);
  });

  it("대체공휴일과 선거일을 포함한다", () => {
    expect(holidays).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: "2026-03-02", kind: "substitute" }),
      expect.objectContaining({ date: "2026-06-03", kind: "election" }),
      expect.objectContaining({ date: "2026-07-17", name: "제헌절" }),
    ]));
  });
});
