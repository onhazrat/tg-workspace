import { describe, expect, it } from "bun:test"
import { telegramWebViewPostUrl as url } from "@/lib/telegram-web"
import type { Post } from "@/types"
import {
  EXPORT_LIMIT,
  limitNote,
  postLinks,
  postsMarkdown,
} from "./selected-export"

/** Copy links and Export Markdown over the selected Posts the filter shows (PTR-06). */

const post = (id: number, text: string, channelName = "chan"): Post =>
  ({
    id,
    channelName,
    text,
    date: "2026-10-01T10:00:00Z",
    timestamp: Date.UTC(2026, 9, 1, 10, id),
  }) as Post

describe("postLinks", () => {
  it("is one Telegram link per line, in the feed's order", () => {
    expect(postLinks([post(2, "b"), post(1, "a", "other")])).toBe(
      `${url("chan", 2)}\n${url("other", 1)}`,
    )
  })
})

describe("postsMarkdown", () => {
  it("heads each Post with its Channel and links it, keeping its text", () => {
    const md = postsMarkdown([post(2, "first line\nsecond"), post(1, "")])

    expect(md).toContain("## @chan · 2026-10-01 10:02 UTC")
    expect(md).toContain("first line\nsecond")
    expect(md).toContain(`[Open in Telegram](${url("chan", 2)})`)
    expect(md.indexOf("chan/2")).toBeLessThan(md.indexOf("chan/1"))
  })
})

describe("limitNote", () => {
  it("says so only when the limit cut the list", () => {
    expect(limitNote(EXPORT_LIMIT - 1)).toBe("")
    expect(limitNote(EXPORT_LIMIT)).toContain("first 5,000")
  })
})
