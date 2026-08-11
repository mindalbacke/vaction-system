import { describe, expect, it } from "vitest";
import { getAudioShift } from "./rotation";

describe("음향보조 2주 자동 교대", () => {
  it("같은 14일 동안 두 그룹이 서로 다른 근무를 유지한다", () => {
    expect(getAudioShift("2026-08-03", 0)).toBe("U");
    expect(getAudioShift("2026-08-16", 0)).toBe("U");
    expect(getAudioShift("2026-08-03", 1)).toBe("A");
  });

  it("14일이 지나면 A와 U가 서로 바뀐다", () => {
    expect(getAudioShift("2026-08-17", 0)).toBe("A");
    expect(getAudioShift("2026-08-17", 1)).toBe("U");
  });

  it("직원별 기준일과 시작 근무를 반영한다", () => {
    expect(getAudioShift("2026-09-01", 0, "2026-09-01", "A")).toBe("A");
    expect(getAudioShift("2026-09-14", 0, "2026-09-01", "A")).toBe("A");
    expect(getAudioShift("2026-09-15", 0, "2026-09-01", "A")).toBe("U");
  });
});
