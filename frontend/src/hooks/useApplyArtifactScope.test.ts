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
      media: "all",
      maxPerChannel: 0,
      maxPerChannelMode: "latest",
      sort: "time",
    })
  })

  test("a frozen field comes back as it was", () => {
    expect(
      workspaceFromScope({
        ...window,
        channels: ["a", "b"],
        keyword: "rates",
        forwarded: "original",
        media: "photo",
        maxPerChannel: 5,
        maxPerChannelMode: "random",
        sort: "channel_time",
      }),
    ).toEqual({
      channels: new Set(["a", "b"]),
      keyword: "rates",
      forwarded: "original",
      media: "photo",
      maxPerChannel: 5,
      maxPerChannelMode: "random",
      sort: "channel_time",
    })
  })
})
