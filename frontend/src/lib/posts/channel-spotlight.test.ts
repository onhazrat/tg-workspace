import { describe, expect, test } from "bun:test"
import { toggleNot } from "@/lib/filter-tree"
import {
  enterSpotlight,
  keepSpotlightFilters,
  spotlightView,
  spotlitBar,
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
    expect(printPostFilter(spot.filter)).toBe("channel:durov")
    const kept = keepSpotlightFilters(spot, true, persianVideos)
    expect(printPostFilter(kept.filter)).toBe(
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
    // Leaving is dropping the spotlight: the bar reads the Account's filter
    // again, and nothing above wrote it.
    const controls = { postFilter: persianVideos, setPostFilter: () => {} }
    expect(spotlitBar(controls, null, () => {}).controls.postFilter).toBe(
      persianVideos,
    )
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

describe("spotlitBar", () => {
  const controls = { postFilter: persianVideos, setPostFilter: () => {} }
  const setFilter = () => {}
  const spot = (keepFilters: boolean) => ({
    channel: "durov",
    keepFilters,
    filter: emptyPostFilter(),
    from: "durov_7",
  })

  test("with no spotlight the bar is the Account's", () => {
    expect(spotlitBar(controls, null, setFilter)).toEqual({
      controls,
      keywordIgnored: false,
    })
  })

  test("a spotlight's tree is shown and edited, and the keyword applies only when kept", () => {
    const bar = spotlitBar(controls, spot(false), setFilter)
    expect(bar.controls.postFilter).toEqual(emptyPostFilter())
    expect(bar.controls.setPostFilter).toBe(setFilter)
    expect(bar.keywordIgnored).toBe(true)
    expect(spotlitBar(controls, spot(true), setFilter).keywordIgnored).toBe(
      false,
    )
  })
})
