import { describe, expect, test } from "bun:test"
import { type ChannelGridFacts, channelGridGates } from "./channel-grid-gates"

const idle: ChannelGridFacts = {
  trimCount: "5",
  selectedCount: 3,
  summarizing: false,
  scrapingCount: 0,
  isOffline: false,
  languageFilter: "",
  groupFilter: "",
  search: "",
}
const gates = (over: Partial<ChannelGridFacts> = {}) =>
  channelGridGates({ ...idle, ...over })

describe("channelGridGates", () => {
  test("an idle grid with a selection allows everything", () => {
    expect(gates()).toEqual({
      parsedTrimCount: 5,
      isTrimDisabled: false,
      isScrapeSelectedDisabled: false,
      isScrapeAllDisabled: false,
      isFilteringActive: false,
    })
  })

  test("trim needs a selection and a count of at least one", () => {
    expect(gates({ selectedCount: 0 }).isTrimDisabled).toBe(true)
    expect(gates({ trimCount: "0" }).isTrimDisabled).toBe(true)
    expect(gates({ trimCount: "" }).isTrimDisabled).toBe(true)
    expect(gates({ trimCount: "abc" }).isTrimDisabled).toBe(true)
    expect(gates({ trimCount: "1" }).isTrimDisabled).toBe(false)
    expect(gates({ trimCount: "12x" }).parsedTrimCount).toBe(12)
  })

  test("a running sync or summary blocks trim and both scrapes", () => {
    for (const busy of [{ summarizing: true }, { scrapingCount: 1 }]) {
      const g = gates(busy)
      expect(g.isTrimDisabled).toBe(true)
      expect(g.isScrapeSelectedDisabled).toBe(true)
      expect(g.isScrapeAllDisabled).toBe(true)
    }
  })

  test("offline blocks scraping but not trimming", () => {
    const g = gates({ isOffline: true })
    expect(g.isScrapeSelectedDisabled).toBe(true)
    expect(g.isScrapeAllDisabled).toBe(true)
    expect(g.isTrimDisabled).toBe(false)
  })

  test("scrape selected needs a selection; scrape all does not", () => {
    const g = gates({ selectedCount: 0 })
    expect(g.isScrapeSelectedDisabled).toBe(true)
    expect(g.isScrapeAllDisabled).toBe(false)
  })

  test("any language, group or non-blank search counts as filtering", () => {
    expect(gates({ languageFilter: "fa" }).isFilteringActive).toBe(true)
    expect(gates({ groupFilter: "g1" }).isFilteringActive).toBe(true)
    expect(gates({ search: "news" }).isFilteringActive).toBe(true)
    expect(gates({ search: "   " }).isFilteringActive).toBe(false)
  })
})
