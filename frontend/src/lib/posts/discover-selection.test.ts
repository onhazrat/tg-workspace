import { describe, expect, test } from "bun:test"

import {
  BULK_FOLLOW_CONFIRM_THRESHOLD,
  buildBulkFollowChannels,
  createdChannelNamesFromResults,
  getUnfollowedNames,
  headerCheckboxState,
  isRowCheckboxChecked,
  isRowCheckboxDisabled,
  needsBulkFollowConfirm,
  pruneSelectionAfterFollow,
  toggleSelectAllUnfollowed,
  toggleUnfollowedSelection,
} from "./discover-selection"

const rows = [
  { name: "alpha", isFollowed: false },
  { name: "beta", isFollowed: true },
  { name: "gamma", isFollowed: false },
]

describe("needsBulkFollowConfirm", () => {
  test("true at threshold and above (D7B)", () => {
    expect(needsBulkFollowConfirm(BULK_FOLLOW_CONFIRM_THRESHOLD - 1)).toBe(
      false,
    )
    expect(needsBulkFollowConfirm(BULK_FOLLOW_CONFIRM_THRESHOLD)).toBe(true)
    expect(needsBulkFollowConfirm(12)).toBe(true)
  })
})

describe("row checkbox (D5B)", () => {
  test("followed rows are checked and disabled", () => {
    expect(isRowCheckboxChecked("beta", true, new Set())).toBe(true)
    expect(isRowCheckboxDisabled(true)).toBe(true)
  })

  test("unfollowed rows reflect local selection", () => {
    expect(isRowCheckboxChecked("alpha", false, new Set())).toBe(false)
    expect(isRowCheckboxChecked("alpha", false, new Set(["alpha"]))).toBe(true)
    expect(isRowCheckboxDisabled(false)).toBe(false)
  })

  test("followed toggle is a no-op", () => {
    const selected = new Set(["alpha"])
    expect(toggleUnfollowedSelection("beta", true, selected)).toEqual(selected)
  })

  test("unfollowed toggle adds and removes", () => {
    expect(toggleUnfollowedSelection("alpha", false, new Set())).toEqual(
      new Set(["alpha"]),
    )
    expect(
      toggleUnfollowedSelection("alpha", false, new Set(["alpha"])),
    ).toEqual(new Set())
  })
})

describe("select-all unfollowed", () => {
  test("lists only unfollowed names", () => {
    expect(getUnfollowedNames(rows)).toEqual(["alpha", "gamma"])
  })

  test("header state: unchecked / indeterminate / checked", () => {
    expect(headerCheckboxState(rows, new Set())).toBe("unchecked")
    expect(headerCheckboxState(rows, new Set(["alpha"]))).toBe("indeterminate")
    expect(headerCheckboxState(rows, new Set(["alpha", "gamma"]))).toBe(
      "checked",
    )
  })

  test("select all adds unfollowed; second call clears them", () => {
    const all = toggleSelectAllUnfollowed(rows, new Set())
    expect(all).toEqual(new Set(["alpha", "gamma"]))
    expect(toggleSelectAllUnfollowed(rows, all)).toEqual(new Set())
  })

  test("does not remove unrelated selected names when deselecting", () => {
    const withExtra = new Set(["alpha", "gamma", "other"])
    expect(toggleSelectAllUnfollowed(rows, withExtra)).toEqual(
      new Set(["other"]),
    )
  })
})

describe("pruneSelectionAfterFollow", () => {
  test("keeps only error names", () => {
    const selected = new Set(["a", "b", "c", "d"])
    const next = pruneSelectionAfterFollow(selected, [
      { name: "a", status: "added" },
      { name: "b", status: "skipped" },
      { name: "c", status: "unavailable" },
      { name: "d", status: "error" },
    ])
    expect(next).toEqual(new Set(["d"]))
  })
})

describe("createdChannelNamesFromResults", () => {
  test("includes added and unavailable for D10A", () => {
    expect(
      createdChannelNamesFromResults([
        { name: "a", status: "added" },
        { name: "b", status: "unavailable" },
        { name: "c", status: "skipped" },
        { name: "d", status: "error" },
      ]),
    ).toEqual(["a", "b"])
  })
})

describe("buildBulkFollowChannels", () => {
  test("attaches discoveredVia from samplePost when present", () => {
    const map = new Map([
      [
        "alpha",
        {
          samplePost: {
            channelName: "src",
            postId: 9,
            timestamp: 100,
          },
        },
      ],
      ["gamma", {}],
    ])
    expect(buildBulkFollowChannels(["alpha", "gamma"], map)).toEqual([
      {
        name: "alpha",
        discoveredVia: {
          channelName: "src",
          postId: 9,
          timestamp: 100,
        },
      },
      { name: "gamma" },
    ])
  })
})
