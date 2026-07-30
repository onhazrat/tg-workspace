import { describe, expect, test } from "bun:test"
import { parseSubscriberCount } from "@/lib/subscriber-count"

describe("parseSubscriberCount", () => {
  test("reads an exact count", () => {
    expect(parseSubscriberCount("573")).toBe(573)
  })

  test("expands Telegram's K and M abbreviations", () => {
    expect(parseSubscriberCount("12.5K")).toBe(12_500)
    expect(parseSubscriberCount("1.2M")).toBe(1_200_000)
    expect(parseSubscriberCount("48k")).toBe(48_000)
  })

  test("ignores the thousands separators t.me renders", () => {
    expect(parseSubscriberCount("8 214")).toBe(8214)
    expect(parseSubscriberCount("12,345")).toBe(12_345)
  })

  // A label starting with m or k must not be read as a magnitude suffix.
  test("keeps the count when the label is attached", () => {
    expect(parseSubscriberCount("204 members")).toBe(204)
    expect(parseSubscriberCount("31 khaneh")).toBe(31)
    expect(parseSubscriberCount("12.5K subscribers")).toBe(12_500)
    expect(parseSubscriberCount("1.2 M")).toBe(1_200_000)
  })

  test("a genuine zero is a count, not an absence", () => {
    expect(parseSubscriberCount("0")).toBe(0)
  })

  // The distinction the whole return type exists for: every one of these means
  // "we have no number", and a caller ranking by size must be able to tell them
  // apart from a small channel.
  test("no count is null rather than zero", () => {
    expect(parseSubscriberCount(null)).toBeNull()
    expect(parseSubscriberCount(undefined)).toBeNull()
    expect(parseSubscriberCount("")).toBeNull()
    expect(parseSubscriberCount("subscribers")).toBeNull()
    expect(parseSubscriberCount("—")).toBeNull()
  })
})
