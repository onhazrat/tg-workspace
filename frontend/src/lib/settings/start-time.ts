import type { GlobalStartTimeMode, GlobalStartTimeValue } from "@/types"

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Effective global start time in epoch ms.
 *
 * - "retention": now minus the retention window (0 = no limit).
 * - "relative": now minus `value` days, falling back to the retention window.
 * - "absolute": `value` parsed as a date string; invalid or missing dates -> now.
 *
 * The result is always clamped to the retention window when one is set.
 */
export function computeEffectiveGlobalStartTime(
  mode: GlobalStartTimeMode,
  value: GlobalStartTimeValue,
  postRetentionDays: number,
  now: number = Date.now(),
): number {
  let targetTime = now

  if (mode === "retention") {
    targetTime = postRetentionDays > 0 ? now - postRetentionDays * DAY_MS : 0
  } else if (mode === "relative") {
    if (typeof value === "number" && value > 0) {
      targetTime = now - value * DAY_MS
    } else if (postRetentionDays > 0) {
      targetTime = now - postRetentionDays * DAY_MS
    } else {
      targetTime = 0
    }
  } else if (mode === "absolute") {
    targetTime = typeof value === "string" ? new Date(value).getTime() : now
    if (Number.isNaN(targetTime)) {
      targetTime = now
    }
  }

  // Clamp to retention policy
  if (postRetentionDays > 0) {
    const minAllowedTime = now - postRetentionDays * DAY_MS
    if (targetTime < minAllowedTime) {
      targetTime = minAllowedTime
    }
  }

  return targetTime
}
