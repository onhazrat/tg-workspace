import { describe, expect, test } from "bun:test"
import { parseBound } from "./channel-metrics"

// What a bound editor's fields spell, for the Channels number editor and the
// Posts views editor alike.
describe("parseBound", () => {
  test("each operator reads its fields", () => {
    expect(parseBound("gte", "200", "")).toEqual({ min: 200 })
    expect(parseBound("lte", "1.5", "")).toEqual({ max: 1.5 })
    expect(parseBound("between", "5", "50")).toEqual({ min: 5, max: 50 })
    expect(parseBound("none", "", "")).toEqual({ none: true })
  })

  test("an incomplete or backwards bound is none yet", () => {
    expect(parseBound("gte", "", "")).toBeNull()
    expect(parseBound("gte", "lots", "")).toBeNull()
    expect(parseBound("between", "5", "")).toBeNull()
    expect(parseBound("between", "50", "5")).toBeNull()
  })

  test("a floor refuses what is under it, and only where one is given", () => {
    expect(parseBound("gte", "-1", "")).toEqual({ min: -1 })
    expect(parseBound("gte", "-1", "", { min: 0 })).toBeNull()
    expect(parseBound("between", "0", "-2", { min: 0 })).toBeNull()
    expect(parseBound("gte", "0", "", { min: 0 })).toEqual({ min: 0 })
  })
})
