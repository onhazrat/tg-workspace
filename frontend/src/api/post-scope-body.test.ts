import { describe, expect, it } from "bun:test"
import { MINUTE_MS } from "@/lib/analysis-window"
import { postScopeBody } from "./data"

/**
 * B5: the channel selection moved out of the query string and into a JSON body.
 *
 * The body must describe the *same* scope the query string did — an endpoint
 * reading it should not be able to tell which transport was used. These tests
 * pin that equivalence, including the omit-when-default behaviour, because a
 * silently different scope would show up as wrong counts rather than an error.
 */
//: Minute-aligned and safely in the past, because AW-02 floors a Fixed
//: boundary to the minute and refuses one past the server's current minute.
const MINUTE_AGO = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS - MINUTE_MS
const HOUR_AGO = MINUTE_AGO - 59 * MINUTE_MS

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
        startDate: HOUR_AGO,
        endDate: MINUTE_AGO,
        keyword: "  war  ",
        forwarded: "original",
        media: "photo",
        maxPerChannel: 25,
      }),
    ).toEqual({
      channelNames: ["alpha"],
      window: { mode: "fixed", start: HOUR_AGO, end: MINUTE_AGO },
      keyword: "war",
      forwarded: "original",
      media: "photo",
      maxPerChannel: 25,
    })
  })

  /**
   * AW-02: the pair became a stated window, and the window is what a server
   * resolves. The rest of the body is untouched, which is the half worth
   * pinning — the conversion sits in the one function every scope body goes
   * through, so getting it wrong would change every filter's meaning at once.
   */
  it("states the dates as a Fixed window rather than a raw pair", () => {
    const body = postScopeBody({ startDate: HOUR_AGO, endDate: MINUTE_AGO })

    expect(body.window).toEqual({
      mode: "fixed",
      start: HOUR_AGO,
      end: MINUTE_AGO,
    })
    expect(body.startDate).toBeUndefined()
    expect(body.endDate).toBeUndefined()
  })

  it("preserves a zero date boundary rather than dropping it as falsy", () => {
    expect(postScopeBody({ startDate: 0, endDate: 0 })).toEqual({
      window: { mode: "fixed", start: 0, end: 0 },
    })
  })

  it("sends no window at all when the scope names neither boundary", () => {
    expect(postScopeBody({ channelNames: ["alpha"] })).toEqual({
      channelNames: ["alpha"],
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
