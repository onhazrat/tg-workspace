import { describe, expect, test } from "bun:test"

import type { Channel } from "@/types"
import {
  manualSyncErrorText,
  planManualSync,
  syncAllConfirmation,
} from "./manual-sync"

const open: Channel = { id: "1", name: "open" }
const outOfAll: Channel = {
  id: "2",
  name: "out-of-all",
  includeInSyncAll: false,
}
const outOfBulk: Channel = {
  id: "3",
  name: "out-of-bulk",
  includeInBulkSync: false,
}
const hidden: Channel = {
  id: "4",
  name: "hidden",
  isUnavailableOnWebView: true,
  includeInSyncAll: false,
  includeInBulkSync: false,
}
const all = [open, outOfAll, outOfBulk, hidden]

describe("planManualSync", () => {
  test("Sync All needs a channel and sends only the ones its group includes", () => {
    expect(planManualSync("sync_all", [], new Set())).toEqual({
      refusal: {
        level: "error",
        message: "Please add at least one channel first",
      },
    })
    expect(planManualSync("sync_all", [outOfAll], new Set())).toEqual({
      refusal: { level: "info", message: "No channels eligible for Sync All" },
    })
    expect(planManualSync("sync_all", all, new Set())).toEqual({
      channels: [open, outOfBulk],
      source: "Manual (Sync All)",
      syncMode: "sync_all",
    })
  })

  test("Sync Selected needs a selection and sends only selected bulk-eligible channels", () => {
    expect(planManualSync("bulk", all, new Set())).toEqual({
      refusal: {
        level: "error",
        message: "Please select at least one channel first",
      },
    })
    expect(planManualSync("bulk", all, new Set(["out-of-bulk"]))).toEqual({
      refusal: {
        level: "info",
        message: "No selected channels eligible for bulk sync",
      },
    })
    expect(
      planManualSync("bulk", all, new Set(["open", "out-of-bulk", "gone"])),
    ).toEqual({
      channels: [open],
      source: "Manual (Sync Selected)",
      syncMode: "bulk",
    })
  })

  test("Recheck Restricted sends the Unavailable channels, frozen or not", () => {
    expect(planManualSync("recheck_restricted", [open], new Set())).toEqual({
      refusal: { level: "info", message: "No restricted channels to recheck" },
    })
    expect(planManualSync("recheck_restricted", all, new Set())).toEqual({
      channels: [hidden],
      source: "Manual (Recheck Restricted)",
      syncMode: "recheck_restricted",
    })
  })
})

describe("manualSyncErrorText", () => {
  test("shows the error's own message, or a fallback naming the operation", () => {
    expect(manualSyncErrorText(new Error("boom"), "bulk")).toBe("boom")
    expect(manualSyncErrorText("?", "sync_all")).toBe(
      "An unexpected error occurred during scraping",
    )
    expect(manualSyncErrorText(null, "recheck_restricted")).toBe(
      "An unexpected error occurred during recheck",
    )
  })
})

describe("syncAllConfirmation", () => {
  test("counts what Sync All will send and says how many it skips", () => {
    expect(syncAllConfirmation(all)).toEqual({
      count: 2,
      description:
        "Sync 2 channels now? 2 frozen or excluded from Sync All will be skipped.",
    })
    expect(syncAllConfirmation([open])).toEqual({
      count: 1,
      description: "Sync 1 channel now?",
    })
  })

  test("its count is what the sync sends", () => {
    const plan = planManualSync("sync_all", all, new Set())
    if ("refusal" in plan) throw new Error("expected a plan")
    expect(syncAllConfirmation(all).count).toBe(plan.channels.length)
  })
})
