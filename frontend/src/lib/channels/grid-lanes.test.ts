import { describe, expect, it } from "bun:test"
import { gridLanesForWidth, MAX_GRID_LANES } from "./grid-lanes"

describe("gridLanesForWidth", () => {
  it("matches the Tailwind breakpoints the grid was styled with", () => {
    // grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4
    expect(gridLanesForWidth(320)).toBe(1)
    expect(gridLanesForWidth(767)).toBe(1)
    expect(gridLanesForWidth(768)).toBe(2)
    expect(gridLanesForWidth(1023)).toBe(2)
    expect(gridLanesForWidth(1024)).toBe(3)
    expect(gridLanesForWidth(1279)).toBe(3)
    expect(gridLanesForWidth(1280)).toBe(4)
    expect(gridLanesForWidth(2560)).toBe(4)
  })

  it("never returns zero, which would divide by zero when laying out rows", () => {
    for (const width of [0, 1, -10]) {
      expect(gridLanesForWidth(width)).toBeGreaterThanOrEqual(1)
    }
  })

  it("never exceeds the declared maximum", () => {
    for (const width of [320, 768, 1024, 1280, 4000]) {
      expect(gridLanesForWidth(width)).toBeLessThanOrEqual(MAX_GRID_LANES)
    }
  })
})
