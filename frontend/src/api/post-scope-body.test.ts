import { describe, expect, it } from "bun:test"
import { postScopeBody } from "./data"

/**
 * B5: the channel selection moved out of the query string and into a JSON body.
 *
 * The body must describe the *same* scope the query string did — an endpoint
 * reading it should not be able to tell which transport was used. These tests
 * pin that equivalence, including the omit-when-default behaviour, because a
 * silently different scope would show up as wrong counts rather than an error.
 */
describe("postScopeBody", () => {
  it("carries a channel selection as a list, not a joined string", () => {
    expect(postScopeBody({ channelNames: ["alpha", "beta"] })).toEqual({
      channelNames: ["alpha", "beta"],
    })
  })

  it("omits every default, matching the query-string builder", () => {
    expect(
      postScopeBody({
        channelNames: [],
        forwarded: "all",
        media: "all",
        maxPerChannel: 0,
        keyword: "   ",
      }),
    ).toEqual({})
  })

  it("keeps non-default filters", () => {
    expect(
      postScopeBody({
        channelNames: ["alpha"],
        startDate: 1_000,
        endDate: 2_000,
        keyword: "  war  ",
        forwarded: "original",
        media: "photo",
        maxPerChannel: 25,
      }),
    ).toEqual({
      channelNames: ["alpha"],
      startDate: 1_000,
      endDate: 2_000,
      keyword: "war",
      forwarded: "original",
      media: "photo",
      maxPerChannel: 25,
    })
  })

  it("preserves a zero date boundary rather than dropping it as falsy", () => {
    expect(postScopeBody({ startDate: 0, endDate: 0 })).toEqual({
      startDate: 0,
      endDate: 0,
    })
  })

  /**
   * The reason this endpoint moved off GET: ~1,070 handles is a routine account
   * size and would have produced a request line over 10 KB.
   */
  it("handles an account-sized selection that a URL could not carry", () => {
    const channelNames = Array.from(
      { length: 1_070 },
      (_, i) => `channel${String(i).padStart(5, "0")}`,
    )
    const body = postScopeBody({ channelNames })

    expect((body.channelNames as string[]).length).toBe(1_070)
    expect(channelNames.join(",").length).toBeGreaterThan(10_000)
  })
})
