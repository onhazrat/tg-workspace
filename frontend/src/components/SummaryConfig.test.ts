import { describe, expect, test } from "bun:test"
import { summaryActionsDisabled } from "./SummaryConfig"

const ready = {
  scraping: false,
  summarizing: false,
  copyingPrompt: false,
  hasChannels: true,
  hasPostsInScope: true,
}

describe("summaryActionsDisabled", () => {
  test("enabled only when idle with channels and posts in scope", () => {
    expect(summaryActionsDisabled(ready)).toBe(false)
    for (const blocker of [
      { scraping: true },
      { summarizing: true },
      { copyingPrompt: true },
      { hasChannels: false },
      { hasPostsInScope: false },
    ]) {
      expect(summaryActionsDisabled({ ...ready, ...blocker })).toBe(true)
    }
  })
})
