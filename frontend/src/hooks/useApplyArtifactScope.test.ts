/**
 * What "Use this Scope" puts back. A field the Artifact did not freeze resets
 * to the workspace default rather than keeping whatever filter was on, because
 * the restored Scope has to select the Posts the Artifact came from.
 */
import { describe, expect, test } from "bun:test"

import { printPostFilter } from "@/lib/posts/post-filter"
import {
  DEFAULT_SELECTION,
  EMPTY_SNAPSHOT,
  pick,
  rule,
} from "@/lib/posts/post-selection"
import { workspaceFromScope } from "./useApplyArtifactScope"

const window = { start: 1, end: 2 }

/** The restored workspace with its Post filter as text, which a parse mints ids for. */
const restored = (scope: Parameters<typeof workspaceFromScope>[0]) => {
  const { postFilter, ...rest } = workspaceFromScope(scope)
  return { ...rest, postFilter: printPostFilter(postFilter) }
}

describe("workspaceFromScope", () => {
  test("an absent field resets to its default", () => {
    expect(restored(window)).toEqual({
      channels: new Set(),
      keyword: "",
      postFilter: "",
      viewMeasure: "estimated",
      maxPerChannel: 0,
      maxPerChannelMode: "ordered",
      sort: "newest",
      groupByChannel: false,
      selection: DEFAULT_SELECTION,
    })
  })

  // An Artifact made before PTR-03 froze flat filters; they come back as the
  // Post filter that says the same, so the view shows the Posts it read.
  test("a frozen field comes back as it was", () => {
    expect(
      restored({
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
      postFilter:
        "type:original and (media:photo or media:video) and (lang:fa or lang:en) and views <= 900",
      viewMeasure: "views",
      maxPerChannel: 5,
      maxPerChannelMode: "random",
      sort: "most_views",
      groupByChannel: true,
      // Before PTR-05 the keyword and the cap said what it covered.
      selection: [
        rule(true, {
          tree: null,
          keyword: "rates",
          sort: "most_views",
          viewMeasure: "views",
          maxPerChannel: 5,
          maxPerChannelMode: "random",
          seed: 0,
        }),
      ],
    })
  })

  test("a ranked Artifact from before comes back as those Posts", () => {
    const posts = [{ channelName: "a", postId: 3 }]

    expect(workspaceFromScope({ ...window, posts }).selection).toEqual([
      rule(false),
      pick(true, { channelName: "a", id: 3 }),
    ])
  })

  test("a frozen Post selection comes back as it was (PTR-05)", () => {
    const selection = [
      rule(false, { ...EMPTY_SNAPSHOT, keyword: "rates" }),
      pick(true, { channelName: "a", id: 7 }),
    ]

    expect(workspaceFromScope({ ...window, selection }).selection).toEqual(
      selection,
    )
  })
})
