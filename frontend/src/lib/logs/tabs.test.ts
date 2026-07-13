import { describe, expect, test } from "bun:test"

import { LOG_TAB_META, LOG_TABS } from "@/lib/logs/tabs"

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
