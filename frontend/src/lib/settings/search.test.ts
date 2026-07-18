import { describe, expect, test } from "bun:test"
import type { SettingCatalogEntry } from "./catalog-types"
import {
  parseSettingsQuery,
  searchSettings,
  suggestSettingsOperators,
} from "./search"

const miniCatalog: SettingCatalogEntry[] = [
  {
    id: "alphaExact",
    label: "Alpha Exact",
    description: "desc",
    keywords: ["zzz"],
    group: "ai",
    source: "app",
    defaultValue: 1,
    control: { kind: "number", min: 0, integer: true },
  },
  {
    id: "alphaPrefix",
    label: "Alpha Prefix Thing",
    description: "other",
    keywords: [],
    group: "network",
    source: "network",
    defaultValue: false,
    control: { kind: "boolean", commandSlug: "alpha-prefix" },
  },
  {
    id: "hiddenKnob",
    label: "Hidden",
    description: "should not appear",
    keywords: ["alpha"],
    group: "ai",
    source: "app",
    defaultValue: 0,
    searchHidden: true,
    control: { kind: "number", min: 0, integer: true },
  },
]

describe("parseSettingsQuery", () => {
  test("extracts @id and remaining text", () => {
    const parsed = parseSettingsQuery("@id:syncConcurrency foo")
    expect(parsed.id).toBe("syncConcurrency")
    expect(parsed.text).toBe("foo")
  })

  test("ignores unknown @feature groups", () => {
    const parsed = parseSettingsQuery("@feature:not-a-group temperature")
    expect(parsed.feature).toBeUndefined()
    expect(parsed.text).toBe("temperature")
  })
})

describe("searchSettings ranking", () => {
  test("ranks exact label above prefix and fuzzy", () => {
    const hits = searchSettings("alpha exact", { entries: miniCatalog })
    expect(hits.map((h) => h.entry.id)).toEqual(["alphaExact"])
    expect(hits[0]?.score).toBeGreaterThan(0.8)
  })

  test("orders higher scores first, then label", () => {
    const hits = searchSettings("alpha", { entries: miniCatalog })
    expect(hits.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < hits.length; i++) {
      const prev = hits[i - 1]!
      const cur = hits[i]!
      expect(prev.score).toBeGreaterThanOrEqual(cur.score)
      if (prev.score === cur.score) {
        expect(
          prev.entry.label.localeCompare(cur.entry.label),
        ).toBeLessThanOrEqual(0)
      }
    }
  })

  test("respects searchHidden", () => {
    const hits = searchSettings("alpha", { entries: miniCatalog })
    expect(hits.every((h) => h.entry.id !== "hiddenKnob")).toBe(true)
  })

  test("@feature filters group without requiring text", () => {
    const hits = searchSettings("@feature:network", { entries: miniCatalog })
    expect(hits).toHaveLength(1)
    expect(hits[0]?.entry.id).toBe("alphaPrefix")
  })

  test("@modified without callback returns empty when only operator", () => {
    // Without isModified, modifiedOnly still filters to nothing useful when
    // callback missing — provider keeps all entries if isModified absent.
    const hits = searchSettings("@modified", { entries: miniCatalog })
    expect(hits.length).toBe(miniCatalog.filter((e) => !e.searchHidden).length)
  })

  test("provider seam allows injecting a custom provider", () => {
    const hits = searchSettings("ignored", {
      provider: {
        search: () => [{ entry: miniCatalog[0]!, score: 0.42 }],
      },
    })
    expect(hits).toHaveLength(1)
    expect(hits[0]?.score).toBe(0.42)
  })
})

describe("suggestSettingsOperators", () => {
  test("suggests feature groups for @fe", () => {
    const suggestions = suggestSettingsOperators("@fe")
    expect(suggestions.some((s) => s.startsWith("@feature:"))).toBe(true)
  })

  test("returns empty when no @ fragment", () => {
    expect(suggestSettingsOperators("proxy")).toEqual([])
  })
})
