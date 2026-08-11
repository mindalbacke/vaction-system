import type { ShiftCode } from "@/lib/domain";

const DAY_MS = 86_400_000;
export const AUDIO_ROTATION_START = "2026-08-03";

function daysBetween(from: string, to: string) {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function getAudioShift(
  date: string,
  audioIndex: number,
  startDate = AUDIO_ROTATION_START,
  startShift?: "A" | "U",
): Extract<ShiftCode, "A" | "U"> {
  const blocks = Math.floor(daysBetween(startDate, date) / 14);
  const baseShift = startShift ?? (audioIndex % 2 === 0 ? "U" : "A");
  return Math.abs(blocks) % 2 === 0 ? baseShift : baseShift === "A" ? "U" : "A";
}
