import type { Channel } from "@/types"
import { filterChannelsForOperation } from "./sync-permissions"

/** The three sync buttons: Sync All, Sync Selected and Recheck Restricted. */
export type ManualSyncMode = "sync_all" | "bulk" | "recheck_restricted"

export type ManualSyncPlan =
  | { refusal: { level: "error" | "info"; message: string } }
  | { channels: Channel[]; source: string; syncMode: ManualSyncMode }

const MANUAL_SYNC: Record<
  ManualSyncMode,
  {
    source: string
    noneEligible: string
    failure: string
    eligible: (channels: Channel[], selected: Set<string>) => Channel[]
  }
> = {
  sync_all: {
    source: "Manual (Sync All)",
    noneEligible: "No channels eligible for Sync All",
    failure: "An unexpected error occurred during scraping",
    eligible: (channels) => filterChannelsForOperation(channels, "sync_all"),
  },
  bulk: {
    source: "Manual (Sync Selected)",
    noneEligible: "No selected channels eligible for bulk sync",
    failure: "An unexpected error occurred during scraping",
    eligible: (channels, selected) =>
      filterChannelsForOperation(
        channels.filter((channel) => selected.has(channel.name)),
        "bulk",
      ),
  },
  recheck_restricted: {
    source: "Manual (Recheck Restricted)",
    noneEligible: "No restricted channels to recheck",
    failure: "An unexpected error occurred during recheck",
    eligible: (channels) =>
      channels.filter((channel) => channel.isUnavailableOnWebView),
  },
}

/** Which channels a sync button sends, or why it sends none. */
export function planManualSync(
  mode: ManualSyncMode,
  channels: Channel[],
  selectedChannels: Set<string>,
): ManualSyncPlan {
  if (mode === "sync_all" && channels.length === 0) {
    return {
      refusal: {
        level: "error",
        message: "Please add at least one channel first",
      },
    }
  }
  if (mode === "bulk" && selectedChannels.size === 0) {
    return {
      refusal: {
        level: "error",
        message: "Please select at least one channel first",
      },
    }
  }
  const { eligible, noneEligible, source } = MANUAL_SYNC[mode]
  const toSync = eligible(channels, selectedChannels)
  if (toSync.length === 0) {
    return { refusal: { level: "info", message: noneEligible } }
  }
  return { channels: toSync, source, syncMode: mode }
}

export function manualSyncErrorText(
  err: unknown,
  mode: ManualSyncMode,
): string {
  return err instanceof Error ? err.message : MANUAL_SYNC[mode].failure
}
