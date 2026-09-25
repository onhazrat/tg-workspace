import { describe, expect, it } from "bun:test"

import type { Post } from "@/types"

import { formatPostsForTagPrompt } from "./tag-prompt"

const post = (channelName: string, id: number, day: number, text: string) =>
  ({
    channelName,
    id,
    timestamp: Date.UTC(2026, 0, day),
    text,
  }) as Post

describe("formatPostsForTagPrompt", () => {
  it("groups selected channels' posts, oldest first, on one line each", () => {
    const text = formatPostsForTagPrompt(
      [
        post("beta", 9, 3, "later"),
        post("alpha", 2, 5, "  two\nlines  "),
        post("beta", 4, 1, "earlier"),
        post("ignored", 1, 1, "not selected"),
      ],
      ["alpha", "beta"],
    )
    expect(text).toBe(
      [
        "### beta",
        "Posts (chronological):",
        "- [ID 4 | 2026-01-01] earlier",
        "- [ID 9 | 2026-01-03] later",
        "",
        "### alpha",
        "Posts (chronological):",
        "- [ID 2 | 2026-01-05] two lines",
      ].join("\n"),
    )
  })

  it("is empty when no post belongs to a selected channel", () => {
    expect(formatPostsForTagPrompt([post("x", 1, 1, "t")], new Set())).toBe("")
  })
})
