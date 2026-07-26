import { describe, expect, it } from "bun:test"
import { channelGridCountLabel } from "./grid-count-label"

describe("channelGridCountLabel", () => {
  /**
   * The A/C1 case: 20 of 1,070 rendered, no filter. Before this, the grid gave
   * no indication that 1,050 more existed.
   */
  it("reports the slice when more channels exist than are rendered", () => {
    expect(
      channelGridCountLabel({ shown: 20, filtered: 1070, total: 1070 }),
    ).toBe("Showing 20 of 1070 channels")
  })

  it("adds the unfiltered total when a filter is narrowing the grid", () => {
    expect(
      channelGridCountLabel({ shown: 20, filtered: 43, total: 1070 }),
    ).toBe("Showing 20 of 43 channels matching · 1070 total")
  })

  it("drops the 'showing' clause once every match is rendered", () => {
    expect(
      channelGridCountLabel({ shown: 43, filtered: 43, total: 1070 }),
    ).toBe("43 channels matching · 1070 total")
  })

  it("says nothing when the unfiltered grid is fully visible", () => {
    expect(channelGridCountLabel({ shown: 12, filtered: 12, total: 12 })).toBe(
      null,
    )
  })

  it("says nothing when there is nothing to show", () => {
    expect(channelGridCountLabel({ shown: 0, filtered: 0, total: 1070 })).toBe(
      null,
    )
  })

  it("pluralizes a single channel correctly", () => {
    expect(channelGridCountLabel({ shown: 1, filtered: 1, total: 1070 })).toBe(
      "1 channel matching · 1070 total",
    )
  })

  it("tolerates a shown count that overshoots the filtered count", () => {
    // `visibleCount` is a cap, not a measurement, so it can exceed the list.
    expect(channelGridCountLabel({ shown: 20, filtered: 5, total: 1070 })).toBe(
      "5 channels matching · 1070 total",
    )
  })
})
