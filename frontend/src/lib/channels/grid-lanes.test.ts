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

describe("gridLanesForWidth at a zoom level", () => {
  it("keeps today's breakpoints at zoom 0", () => {
    for (const width of [320, 767, 768, 1023, 1024, 1279, 1280, 2560]) {
      expect(gridLanesForWidth(width, 0)).toBe(gridLanesForWidth(width))
    }
  })

  it("packs more cards per row when zoomed out", () => {
    // A 1280px grid holds 4 normal cards; compact cards are about 220px and
    // avatar tiles about 72px, each with a 16px gap.
    expect(gridLanesForWidth(1280, -1)).toBe(5)
    expect(gridLanesForWidth(1280, -2)).toBe(14)
    expect(gridLanesForWidth(767, -1)).toBe(3)
  })

  it("gives detailed cards no more columns than normal ones", () => {
    expect(gridLanesForWidth(1280, 1)).toBe(3)
    for (const width of [320, 768, 1024, 1280, 2560]) {
      expect(gridLanesForWidth(width, 1)).toBeLessThanOrEqual(
        gridLanesForWidth(width, 0),
      )
    }
  })

  it("never returns zero at any zoom level", () => {
    for (const zoom of [-2, -1, 0, 1] as const) {
      expect(gridLanesForWidth(0, zoom)).toBe(1)
    }
  })
})
