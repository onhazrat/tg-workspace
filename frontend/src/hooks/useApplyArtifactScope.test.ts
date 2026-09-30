/**
 * What "Use this Scope" puts back. A field the Artifact did not freeze resets
 * to the workspace default rather than keeping whatever filter was on, because
 * the restored Scope has to select the Posts the Artifact came from.
 */
import { describe, expect, test } from "bun:test"

import { workspaceFromScope } from "./useApplyArtifactScope"

const window = { start: 1, end: 2 }

describe("workspaceFromScope", () => {
  test("an absent field resets to its default", () => {
    expect(workspaceFromScope(window)).toEqual({
      channels: new Set(),
      keyword: "",
      forwarded: "all",
      media: [],
      languages: [],
      viewMeasure: "estimated",
      views: null,
      maxPerChannel: 0,
      maxPerChannelMode: "ordered",
      sort: "newest",
      groupByChannel: false,
    })
  })

  test("a frozen field comes back as it was", () => {
    expect(
      workspaceFromScope({
        ...window,
        channels: ["a", "b"],
        keyword: "rates",
        forwarded: "original",
        media: ["photo", "video"],
        languages: ["fa", "en"],
        viewMeasure: "views",
        views: { op: "lte", value: 900 },
        maxPerChannel: 5,
        maxPerChannelMode: "random",
        sort: "most_views",
        groupByChannel: true,
      }),
    ).toEqual({
      channels: new Set(["a", "b"]),
      keyword: "rates",
      forwarded: "original",
      media: ["photo", "video"],
      languages: ["fa", "en"],
      viewMeasure: "views",
      views: { op: "lte", value: 900 },
      maxPerChannel: 5,
      maxPerChannelMode: "random",
      sort: "most_views",
      groupByChannel: true,
    })
  })
})
