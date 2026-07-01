import { describe, expect, test } from "bun:test"

import { getRelativeTime } from "@/lib/utils"

describe("getRelativeTime", () => {
  test("returns Never for missing timestamp", () => {
    expect(getRelativeTime(undefined)).toBe("Never")
  })

  test("formats past timestamps", () => {
    const now = Date.now()
    expect(getRelativeTime(now - 45_000)).toBe("Just now")
    expect(getRelativeTime(now - 5 * 60_000)).toBe("5m ago")
    expect(getRelativeTime(now - 3 * 3_600_000)).toBe("3h ago")
    expect(getRelativeTime(now - 2 * 86_400_000)).toBe("2d ago")
  })

  test("formats future timestamps", () => {
    const now = Date.now()
    expect(getRelativeTime(now + 30_000)).toBe("Soon")
    expect(getRelativeTime(now + 10 * 60_000)).toBe("in 10m")
    expect(getRelativeTime(now + 2 * 3_600_000)).toBe("in 2h")
    expect(getRelativeTime(now + 4 * 86_400_000)).toBe("in 4d")
  })
})
