/**
 * The moments a Channel filter Time bound tests (TB-03, ADR-033): every
 * timestamp a followed Channel carries. The key is the URL form's word.
 */
import type { Channel } from "@/types"

export type ChannelMomentKey =
  | "followed_at"
  | "updated_at"
  | "sync_start_at"
  | "oldest_post_at"
  | "next_regular_sync_at"
  | "next_dynamic_sync_at"
  | "discovered_at"

export type ChannelMoment = {
  key: ChannelMomentKey
  label: string
  description: string
  /** Epoch ms, or `null` for a Channel with no value. */
  value: (c: Channel) => number | null
}

/** In the Filters dropdown's order. */
export const CHANNEL_MOMENTS: ChannelMoment[] = [
  {
    key: "followed_at",
    label: "Followed",
    description: "When you followed it.",
    value: (c) => c.followedAt ?? null,
  },
  {
    key: "updated_at",
    label: "Last update",
    description: "When its name, photo and counters were last refreshed.",
    value: (c) => c.lastUpdated ?? null,
  },
  {
    key: "sync_start_at",
    label: "Sync start",
    description: "How far back its history is synced.",
    value: (c) => c.startTime ?? null,
  },
  {
    key: "oldest_post_at",
    label: "Oldest stored post",
    description: "The oldest of its Posts this workspace keeps.",
    value: (c) => c.oldestStoredPostTimestamp ?? null,
  },
  {
    key: "next_regular_sync_at",
    label: "Next regular sync",
    description: "When its regular sync runs next.",
    value: (c) => c.nextRegularSyncAt ?? null,
  },
  {
    key: "next_dynamic_sync_at",
    label: "Next dynamic sync",
    description: "When its dynamic sync runs next.",
    value: (c) => c.nextDynamicSyncAt ?? null,
  },
  {
    key: "discovered_at",
    label: "Discovered",
    description: "When the forwarded Post that led you to it was published.",
    value: (c) => c.discoveredVia?.timestamp ?? null,
  },
]

const BY_KEY = new Map(CHANNEL_MOMENTS.map((m) => [m.key, m]))

export const channelMoment = (key: ChannelMomentKey): ChannelMoment =>
  BY_KEY.get(key) as ChannelMoment

/** A moment's values across `channels`, ascending; no value left out. */
export const momentValues = (
  key: ChannelMomentKey,
  channels: Channel[],
): number[] =>
  channels
    .map(channelMoment(key).value)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b)
