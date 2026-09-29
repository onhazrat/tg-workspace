import { describe, expect, it } from "bun:test"

import type { Post, PostMediaKind } from "@/types"

import {
  getMediaKindLabel,
  type MediaKind,
  matchesMediaFilter,
  parseMediaFilterValue,
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
  // Each kind as a set of one, which is exactly what the single value was
  // before PFB-01; `"all"` is the empty set.
  const kinds: MediaKind[] = [
    "text_only",
    "media_only",
    "photo",
    "video",
    "link_preview",
    "grouped",
  ]
  const passing = (p: Post): ("all" | MediaKind)[] => [
    ...(matchesMediaFilter(p, []) ? (["all"] as const) : []),
    ...kinds.filter((k) => matchesMediaFilter(p, [k])),
  ]

  it.each<[string, Post, ("all" | MediaKind)[]]>([
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

describe("matchesMediaFilter — a set of kinds (PFB-01)", () => {
  const post = (text: string, media?: Post["media"]) =>
    ({ id: 1, channelName: "a", timestamp: 0, text, media }) as Post

  it("keeps a Post matching any kind in the set", () => {
    const photo = post("look", { kinds: ["photo"] })
    const plain = post("hello")

    expect(matchesMediaFilter(photo, ["video", "photo"])).toBe(true)
    expect(matchesMediaFilter(plain, ["video", "photo"])).toBe(false)
    expect(matchesMediaFilter(plain, ["video", "text_only"])).toBe(true)
  })
})

describe("parseMediaFilterValue", () => {
  it.each<[string | null, MediaKind[]]>([
    [null, []],
    ["", []],
    // The previous bundle's single value.
    ["all", []],
    ["photo", ["photo"]],
    // PFB-01's JSON array.
    ['["photo","video"]', ["photo", "video"]],
    ['["photo","photo"]', ["photo"]],
    ['["photo","hologram",3]', ["photo"]],
    // Anything unreadable is any media, as it always was.
    ["hologram", []],
    ["{not json", []],
    ['{"kinds":["photo"]}', []],
  ])("%p reads as %p", (raw, expected) => {
    expect(parseMediaFilterValue(raw)).toEqual(expected)
  })
})
