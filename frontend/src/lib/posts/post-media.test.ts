import { describe, expect, it } from "bun:test"

import type { Post, PostMediaKind } from "@/types"

import {
  getMediaKindLabel,
  type MediaFilterValue,
  matchesMediaFilter,
} from "./post-media"

describe("getMediaKindLabel", () => {
  it.each<[PostMediaKind, string]>([
    ["photo", "Photo"],
    ["video", "Video"],
    ["voice", "Voice"],
    ["audio", "Audio"],
    ["document", "Document"],
    ["poll", "Poll"],
    ["sticker", "Sticker"],
    ["link_preview", "Link"],
    ["grouped", "Album"],
  ])("%s reads as %s", (kind, label) => {
    expect(getMediaKindLabel(kind)).toBe(label)
  })

  it("passes an unknown kind from a newer server through unchanged", () => {
    expect(getMediaKindLabel("gif" as PostMediaKind)).toBe("gif")
  })
})

/**
 * The browser's copy of the media filter, which has to agree with
 * `backend/app/services/post_filters.py`. Each row is one post shape against
 * every filter value, so a branch answering for the wrong value shows up.
 */
describe("matchesMediaFilter", () => {
  const post = (text: string, media?: Post["media"]) =>
    ({ id: 1, channelName: "a", timestamp: 0, text, media }) as Post
  const filters: MediaFilterValue[] = [
    "all",
    "text_only",
    "media_only",
    "photo",
    "video",
    "link_preview",
    "grouped",
  ]
  const passing = (p: Post) => filters.filter((f) => matchesMediaFilter(p, f))

  it.each<[string, Post, MediaFilterValue[]]>([
    ["plain text", post("hello"), ["all", "text_only"]],
    [
      "a captioned photo",
      post("look at this", { kinds: ["photo"] }),
      ["all", "photo"],
    ],
    [
      "a photo flagged media-only by the server",
      post("", { kinds: ["photo"], isMediaOnly: true }),
      ["all", "media_only", "photo"],
    ],
    [
      "a video with the no-text placeholder",
      post("[Media/No Text Content]", { kinds: ["video"] }),
      ["all", "media_only", "video"],
    ],
    [
      "a voice note whose text is its bracket label",
      post("  [Voice] 0:12", { kinds: ["voice"] }),
      ["all", "media_only"],
    ],
    [
      "a link preview",
      post("read https://x.y", { kinds: ["link_preview"] }),
      ["all", "link_preview"],
    ],
    [
      "an album known only by its count",
      post("trip", { kinds: ["photo"], groupedCount: 3 }),
      ["all", "photo", "grouped"],
    ],
    [
      "an album of one is not grouped",
      post("trip", { kinds: ["photo"], groupedCount: 1 }),
      ["all", "photo"],
    ],
    [
      "a grouped kind",
      post("trip", { kinds: ["grouped"] }),
      ["all", "grouped"],
    ],
    // A label with no media behind it is still text as far as filtering goes.
    ["a bracket label with no media", post("[Photo]"), ["all", "text_only"]],
  ])("%s", (_label, p, expected) => {
    expect(passing(p)).toEqual(expected)
  })
})
