import { describe, expect, test } from "bun:test"
import { nextRingIndex } from "./grid-keyboard"

describe("nextRingIndex", () => {
  test("j and k step one card in reading order, across rows", () => {
    expect(nextRingIndex(3, "j", 10)).toBe(4)
    expect(nextRingIndex(4, "k", 10)).toBe(3)
  })

  test("nothing moves past either end", () => {
    expect(nextRingIndex(0, "k", 10)).toBe(0)
    expect(nextRingIndex(9, "j", 10)).toBe(9)
  })

  test("G is the last card and gg the first", () => {
    expect(nextRingIndex(4, "last", 10)).toBe(9)
    expect(nextRingIndex(4, "first", 10)).toBe(0)
  })
})
