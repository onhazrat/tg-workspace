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

/**
 * The browser's copy of the media filter, which has to agree with
 * `backend/app/services/post_filters.py`. Each row is one post shape against
 * every filter value, so a branch answering for the wrong value shows up.
 */
