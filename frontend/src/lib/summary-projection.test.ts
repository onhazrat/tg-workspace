import { describe, expect, test } from "bun:test"
import {
  SUMMARY_PROMPT_EXCERPT_CHARS,
  toSummaryListItem,
} from "@/lib/summary-projection"
import type { Summary } from "@/types"

function summary(overrides: Partial<Summary> = {}): Summary {
  return {
    id: "s1",
    text: "body",
    channels: ["ch"],
    startDate: 0,
    endDate: 1,
    language: "en",
    timestamp: 1,
    ...overrides,
  }
}

describe("toSummaryListItem", () => {
  test("drops the heavy fields", () => {
    const item = toSummaryListItem(
      summary({
        citedPosts: { "ch-1": { id: 1 } as never },
        promptText: "a prompt",
        chatMessages: [{ role: "user", text: "hi" }],
      }),
    )

    expect("citedPosts" in item).toBe(false)
    expect("promptText" in item).toBe(false)
    expect("chatMessages" in item).toBe(false)
  })

  test("keeps the small fields", () => {
    const item = toSummaryListItem(
      summary({ model: "gemini", note: "n", isStarred: true }),
    )
    expect(item.model).toBe("gemini")
    expect(item.note).toBe("n")
    expect(item.isStarred).toBe(true)
    expect(item.text).toBe("body")
  })

  test("derives chatMessageCount", () => {
    expect(
      toSummaryListItem(
        summary({
          chatMessages: [
            { role: "user", text: "a" },
            { role: "model", text: "b" },
          ],
        }),
      ).chatMessageCount,
    ).toBe(2)
    expect(toSummaryListItem(summary()).chatMessageCount).toBe(0)
  })

  test("truncates a long prompt to an excerpt", () => {
    const item = toSummaryListItem(summary({ promptText: "word ".repeat(100) }))
    expect(item.promptExcerpt).toBeDefined()
    expect(item.promptExcerpt?.length).toBeLessThanOrEqual(
      SUMMARY_PROMPT_EXCERPT_CHARS,
    )
    expect(item.promptExcerpt?.endsWith("…")).toBe(true)
  })

  test("leaves a short prompt intact and collapses whitespace", () => {
    expect(
      toSummaryListItem(summary({ promptText: "hi\n\n  there" })).promptExcerpt,
    ).toBe("hi there")
  })

  test("omits promptExcerpt when there is no prompt", () => {
    expect(toSummaryListItem(summary()).promptExcerpt).toBeUndefined()
  })
})
