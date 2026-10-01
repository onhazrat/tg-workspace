import { describe, expect, test } from "bun:test"
import { toggleNot } from "@/lib/filter-tree"
import {
  enterSpotlight,
  keepSpotlightFilters,
  shownPostFilter,
  spotlightView,
} from "@/lib/posts/channel-spotlight"
import {
  addPostFunnel,
  emptyPostFilter,
  printPostFilter,
} from "@/lib/posts/post-filter"

const persianVideos = addPostFunnel(
  addPostFunnel(emptyPostFilter(), "language", "fa"),
  "media",
  "video",
)

describe("the Channel spotlight", () => {
  test("shows the Channel alone, then with the filters kept", () => {
    const spot = enterSpotlight(null, "durov", "durov_7", persianVideos)
    expect(printPostFilter(shownPostFilter(spot, persianVideos))).toBe(
      "channel:durov",
    )
    const kept = keepSpotlightFilters(spot, true, persianVideos)
    expect(printPostFilter(shownPostFilter(kept, persianVideos))).toBe(
      "channel:durov and lang:fa and media:video",
    )
  })

  test("keeps an OR or negated filter as one block", () => {
    const either = { ...persianVideos, op: "or" as const }
    expect(
      printPostFilter(
        keepSpotlightFilters(
          enterSpotlight(null, "durov", "durov_7", either),
          true,
          either,
        ).filter,
      ),
    ).toBe("channel:durov and (lang:fa or media:video)")
    const negated = toggleNot(persianVideos, "root")
    expect(
      printPostFilter(
        keepSpotlightFilters(
          enterSpotlight(null, "durov", "durov_7", negated),
          true,
          negated,
        ).filter,
      ),
    ).toBe("channel:durov and not (lang:fa and media:video)")
  })

  test("entering, editing and leaving returns the exact filter that was there", () => {
    let spot = enterSpotlight(null, "durov", "durov_7", persianVideos)
    spot = keepSpotlightFilters(spot, true, persianVideos)
    spot = { ...spot, filter: emptyPostFilter() }
    spot = enterSpotlight(spot, "news", "news_3", persianVideos)
    expect(spot.from).toBe("durov_7")
    expect(spot.keepFilters).toBe(true)
    // Leaving is dropping the spotlight, and nothing above wrote the filter.
    expect(shownPostFilter(null, persianVideos)).toBe(persianVideos)
    expect(printPostFilter(persianVideos)).toBe("lang:fa and media:video")
  })

  test("drops the cap and grouping, and the keyword unless the filters are kept", () => {
    const view = {
      channelNames: ["durov", "news"],
      keyword: "rates",
      filter: persianVideos,
      maxPerChannel: 5,
      groupByChannel: true,
    }
    expect(spotlightView(null, view)).toBe(view)
    const spot = enterSpotlight(null, "news", "news_3", persianVideos)
    expect(spotlightView(spot, view)).toEqual({
      channelNames: ["news"],
      keyword: "",
      filter: spot.filter,
      maxPerChannel: 0,
      groupByChannel: false,
    })
    expect(
      spotlightView(keepSpotlightFilters(spot, true, persianVideos), view)
        .keyword,
    ).toBe("rates")
  })
})
