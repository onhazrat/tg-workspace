import { describe, expect, it } from "bun:test"

import type { PostMediaKind } from "@/types"

import { getMediaKindLabel } from "./post-media"

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
