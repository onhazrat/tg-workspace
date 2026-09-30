import { describe, expect, test } from "bun:test"

import {
  activeFilters,
  capCard,
  capPhrase,
  languageLabel,
  languageSummary,
  mediaSummary,
  parseCount,
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
