import { describe, expect, test } from "bun:test"

import {
  activeFilters,
  capCard,
  capPhrase,
  clearChip,
  feedSubtitle,
  languageLabel,
  languageOptions,
  meaningQueryOnKey,
  parseCount,
  postSortChoice,
  postSortDirection,
  postSortKey,
  viewMeasureDescription,
} from "@/lib/posts/post-filter-bar"

describe("parseCount", () => {
  test("any number a person types, with separators", () => {
    expect(parseCount("12")).toBe(12)
    expect(parseCount("1,000")).toBe(1000)
    expect(parseCount(" 2 500 ")).toBe(2500)
    expect(parseCount("25k")).toBe(25_000)
    expect(parseCount("1.5M")).toBe(1_500_000)
  })

  test("blank is no number, and so is nonsense", () => {
    expect(parseCount("")).toBeNull()
    expect(parseCount("   ")).toBeNull()
    expect(parseCount("ten")).toBeNull()
    expect(parseCount("-3")).toBeNull()
  })
})

describe("the Per channel pill", () => {
  test("reads No limit, or the first N named for the order, or Random N", () => {
    expect(capPhrase(0, "ordered", "newest")).toBe("No limit")
    expect(capPhrase(10, "ordered", "newest")).toBe("Newest 10")
    expect(capPhrase(10, "ordered", "oldest")).toBe("Oldest 10")
    expect(capPhrase(10, "random", "oldest")).toBe("Random 10")
    expect(capPhrase(10, "ordered", "most_views")).toBe("Top 10 by views")
    expect(capPhrase(10, "ordered", "fewest_views")).toBe("Bottom 10 by views")
    expect(capPhrase(10, "random", "most_views")).toBe("Random 10")
  })

  test("the first card is titled and described by the order", () => {
    expect(capCard("newest", 10)).toEqual({
      title: "Newest",
      body: "The 10 most recent",
    })
    expect(capCard("oldest", 3)).toEqual({
      title: "Oldest",
      body: "The 3 earliest",
    })
    expect(capCard("most_views", 10)).toEqual({
      title: "Top by views",
      body: "The 10 with the most views",
    })
    expect(capCard("fewest_views", 10)).toEqual({
      title: "Bottom by views",
      body: "The 10 with the fewest views",
    })
  })
})

describe("the views measures", () => {
  test("each says in one line what it reads, with the real floor", () => {
    expect(viewMeasureDescription("views", 3)).toBe(
      "What Telegram shows now. Young posts read low.",
    )
    expect(viewMeasureDescription("estimated", 3)).toBe(
      "What a post's views are expected to settle at. Posts under 3 hours are too new to judge.",
    )
    expect(viewMeasureDescription("estimated", 1)).toContain("under 1 hour ")
  })
})

describe("languageLabel", () => {
  test("names the two codes that are not Languages", () => {
    expect(languageLabel("zxx")).toBe("No text")
    expect(languageLabel("und")).toBe("Undetermined")
    expect(languageLabel("fa", "en")).toBe("Persian")
  })
})

describe("activeFilters", () => {
  const defaults = {
    meaning: "",
    relatedTo: null,
    cap: 0,
    capMode: "ordered" as const,
    order: "newest" as const,
  }

  test("nothing at its default is a chip", () => {
    expect(activeFilters(defaults)).toEqual([])
  })

  // The order and grouping are how the Posts are laid out, not which Posts
  // are shown, so they fill their pills and add no chip. The keyword and the
  // Post filter are the filter row's chips (PTR-03).
  test("a chip for a meaning search and one for the cap", () => {
    const chips = activeFilters({
      ...defaults,
      meaning: "inflation",
      cap: 5,
      capMode: "random",
      order: "oldest",
    })

    expect(chips.map((chip) => chip.label)).toEqual([
      "Meaning: inflation",
      "Random 5 per channel",
    ])
    expect(chips.map((chip) => chip.clears)).toEqual(["meaning", "cap"])
  })
})

describe("clearChip", () => {
  test("each chip resets its own filter to the default", () => {
    const calls: [string, unknown][] = []
    const set = {
      setSemanticSearchQuery: (v: string) => calls.push(["meaning", v]),
      setRelatedPostSearch: (v: unknown) => calls.push(["related", v]),
      setMaxPostsPerChannel: (v: number) => calls.push(["cap", v]),
    }
    for (const what of ["meaning", "related", "cap"] as const)
      clearChip(what, set)
    expect(calls).toEqual([
      ["meaning", ""],
      ["related", null],
      ["cap", 0],
    ])
  })
})

describe("languageOptions", () => {
  test("counted: the server's order, a funnelled absent Language at zero", () => {
    expect(
      languageOptions(
        [
          { value: "fa", count: 9 },
          { value: "en", count: 2 },
        ],
        ["de"],
        ["ru"],
      ),
    ).toEqual([
      { code: "fa", count: 9 },
      { code: "en", count: 2 },
      { code: "ru", count: 0 },
    ])
  })

  test("uncounted: the followed Channels' Languages, deduplicated and sorted", () => {
    expect(languageOptions(undefined, ["fa", "en", "fa"], ["ru"])).toEqual([
      { code: "en" },
      { code: "fa" },
      { code: "ru" },
    ])
  })
})

describe("meaningQueryOnKey", () => {
  test("only Enter in meaning mode with words runs a search", () => {
    expect(meaningQueryOnKey(true, "Enter", "  rates ")).toBe("rates")
    expect(meaningQueryOnKey(true, "a", "rates")).toBeNull()
    expect(meaningQueryOnKey(false, "Enter", "rates")).toBeNull()
    expect(meaningQueryOnKey(true, "Enter", "   ")).toBeNull()
  })
})

describe("the Sort menu", () => {
  test("every order reads back as the key and direction that send it", () => {
    for (const order of [
      "newest",
      "oldest",
      "most_views",
      "fewest_views",
    ] as const)
      for (const measure of ["views", "estimated"] as const) {
        const key = postSortKey(order, measure)
        const choice = postSortChoice(key, postSortDirection(order))
        expect(choice.order).toBe(order)
        expect(choice.measure).toBe(key === "date" ? undefined : measure)
      }
  })
})

describe("the feed's subtitle", () => {
  test("names the cap by the order it follows, then the grouping", () => {
    expect(feedSubtitle(0, "ordered", "newest", false)).toBe("")
    expect(feedSubtitle(5, "ordered", "newest", false)).toBe(
      "(max 5/channel, latest)",
    )
    expect(feedSubtitle(5, "ordered", "oldest", true)).toBe(
      "(max 5/channel, earliest) (grouped by channel)",
    )
    expect(feedSubtitle(5, "ordered", "most_views", false)).toContain(
      "top by views",
    )
    expect(feedSubtitle(5, "ordered", "fewest_views", false)).toContain(
      "bottom by views",
    )
    expect(feedSubtitle(5, "random", "most_views", false)).toContain("random")
  })
})
