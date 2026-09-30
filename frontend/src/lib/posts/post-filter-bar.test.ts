import { describe, expect, test } from "bun:test"

import {
  activeFilters,
  capCard,
  capPhrase,
  clearChip,
  languageLabel,
  languageOptions,
  languageSummary,
  meaningQueryOnKey,
  mediaSummary,
  nearestViewStep,
  parseCount,
  VIEW_STEPS,
  viewsSummary,
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

describe("the Views pill", () => {
  test("reads Any, or the side and the number under its measure", () => {
    expect(viewsSummary(null, "estimated")).toBe("Any")
    expect(viewsSummary({ op: "gte", value: 10_000 }, "views")).toBe(
      "Popular, 10K views",
    )
    expect(viewsSummary({ op: "lte", value: 1_000 }, "views")).toBe(
      "Niche, 1K views",
    )
    expect(viewsSummary({ op: "gte", value: 10_000 }, "estimated")).toBe(
      "Popular, 10K est. views",
    )
    expect(viewsSummary({ op: "gte", value: 2_500 }, "views")).toBe(
      "Popular, 2.5K views",
    )
  })

  test("the slider shows the stop nearest a typed number, on a log scale", () => {
    expect(VIEW_STEPS[nearestViewStep(100)]).toBe(100)
    expect(VIEW_STEPS[nearestViewStep(25_000)]).toBe(25_000)
    // 3,000 is nearer 2,500 than 5,000 in log distance, 4,000 nearer 5,000.
    expect(VIEW_STEPS[nearestViewStep(3_000)]).toBe(2_500)
    expect(VIEW_STEPS[nearestViewStep(4_000)]).toBe(5_000)
    expect(VIEW_STEPS[nearestViewStep(0)]).toBe(100)
    expect(VIEW_STEPS[nearestViewStep(5_000_000)]).toBe(1_000_000)
  })
})

describe("pill values", () => {
  test("Media reads Any, the one kind, or N selected", () => {
    expect(mediaSummary([])).toBe("Any")
    expect(mediaSummary(["photo"])).toBe("Photo")
    expect(mediaSummary(["photo", "video"])).toBe("2 selected")
  })

  test("Language names the two codes that are not Languages", () => {
    expect(languageLabel("zxx")).toBe("No text")
    expect(languageLabel("und")).toBe("Undetermined")
    expect(languageLabel("fa", "en")).toBe("Persian")
    expect(languageSummary([])).toBe("Any")
    expect(languageSummary(["zxx"])).toBe("No text")
    expect(languageSummary(["fa", "en"])).toBe("2 selected")
  })
})

describe("activeFilters", () => {
  const defaults = {
    keyword: "",
    meaning: "",
    relatedTo: null,
    forwarded: "all" as const,
    media: [],
    languages: [],
    views: null,
    viewMeasure: "estimated" as const,
    cap: 0,
    capMode: "ordered" as const,
    order: "newest" as const,
  }

  test("nothing at its default is a chip", () => {
    expect(activeFilters(defaults)).toEqual([])
  })

  // The order and grouping are how the Posts are laid out, not which Posts
  // are shown, so they fill their pills and add no chip (the prototype's
  // call).
  test("one chip per active filter, each kind and Language its own", () => {
    const labels = activeFilters({
      ...defaults,
      keyword: "rates",
      meaning: "inflation",
      forwarded: "original",
      media: ["photo", "video"],
      languages: ["zxx"],
      views: { op: "gte", value: 10_000 },
      cap: 5,
      capMode: "random",
      order: "oldest",
    }).map((chip) => chip.label)

    expect(labels).toEqual([
      '"rates"',
      "Meaning: inflation",
      "Original",
      "Photo",
      "Video",
      "No text",
      "Popular, 10K est. views",
      "Random 5 per channel",
    ])
  })

  test("each chip names what its removal clears", () => {
    const keys = activeFilters({
      ...defaults,
      media: ["photo"],
      languages: ["fa"],
    }).map((chip) => chip.clears)

    expect(keys).toEqual([{ media: "photo" }, { language: "fa" }])
  })
})

describe("clearChip", () => {
  function setters() {
    const calls: [string, unknown][] = []
    const media = ["photo", "video"] as const
    const languages = ["fa", "en"]
    return {
      calls,
      set: {
        setPostSearch: (v: string) => calls.push(["keyword", v]),
        setSemanticSearchQuery: (v: string) => calls.push(["meaning", v]),
        setRelatedPostSearch: (v: unknown) => calls.push(["related", v]),
        setForwardedFilter: (v: string) => calls.push(["forwarded", v]),
        setMaxPostsPerChannel: (v: number) => calls.push(["cap", v]),
        setMediaFilter: (u: (m: never[]) => unknown) =>
          calls.push(["media", u([...media] as never[])]),
        setLanguageFilter: (u: (l: string[]) => string[]) =>
          calls.push(["languages", u([...languages])]),
      },
    }
  }

  test("each chip resets its own filter to the default", () => {
    const { calls, set } = setters()
    for (const what of [
      "keyword",
      "meaning",
      "related",
      "forwarded",
      "cap",
    ] as const)
      clearChip(what, set as never)
    expect(calls).toEqual([
      ["keyword", ""],
      ["meaning", ""],
      ["related", null],
      ["forwarded", "all"],
      ["cap", 0],
    ])
  })

  test("a kind or a Language chip drops that one from its set", () => {
    const { calls, set } = setters()
    clearChip({ media: "photo" }, set as never)
    clearChip({ language: "en" }, set as never)
    expect(calls).toEqual([
      ["media", ["video"]],
      ["languages", ["fa"]],
    ])
  })
})

describe("languageOptions", () => {
  test("counted: the server's order, a ticked absent Language at zero", () => {
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
