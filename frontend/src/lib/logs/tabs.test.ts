import { describe, expect, test } from "bun:test"

import { LOG_TAB_META, LOG_TABS, logQueryRows } from "@/lib/logs/tabs"

describe("log tab metadata", () => {
  test("covers every tab exactly once", () => {
    expect(LOG_TABS).toEqual(["publish", "sync", "llm", "network", "embedding"])
    expect(Object.keys(LOG_TAB_META).sort()).toEqual([...LOG_TABS].sort())
  })

  test("labels, nouns and descriptions line up with tab ids", () => {
    for (const tab of LOG_TABS) {
      const meta = LOG_TAB_META[tab]
      expect(meta.noun.toLowerCase()).toBe(tab)
      expect(meta.label.toLowerCase()).toBe(tab)
      expect(meta.description.length).toBeGreaterThan(0)
    }
  })
})

describe("logQueryRows", () => {
  const empty: string[] = []

  test("a first load in flight is loading, on the stable empty list", () => {
    const got = logQueryRows<string>({ isPending: true }, empty)
    expect(got.rows).toBe(empty)
    expect(got.loading).toBe(true)
  })

  test("a refetch over rows already shown is not loading", () => {
    expect(logQueryRows({ data: ["a"], isPending: true }, empty)).toEqual({
      rows: ["a"],
      loading: false,
    })
  })

  test("a settled empty answer is not loading", () => {
    expect(logQueryRows({ data: [], isPending: false }, empty)).toEqual({
      rows: [],
      loading: false,
    })
  })
})
