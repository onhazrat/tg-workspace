/**
 * PROTOTYPE (time-bound): the moments a Channel filter Time bound can test,
 * every timestamp a followed Channel carries. Throwaway: fold the winner in.
 */
import type { Channel } from "@/types"

export type ChannelMomentKey =
  | "followed_at"
  | "last_updated"
  | "sync_start"
  | "oldest_post"
  | "next_regular_sync"
  | "next_dynamic_sync"
  | "discovered_at"

export type ChannelMoment = {
  key: ChannelMomentKey
  label: string
  description: string
  value: (c: Channel) => number | null | undefined
}

export const CHANNEL_MOMENTS: ChannelMoment[] = [
  {
    key: "followed_at",
    label: "Followed",
    description: "When you followed it.",
    value: (c) => c.followedAt,
  },
  {
    key: "last_updated",
    label: "Last update",
    description: "When its name, photo and counters were last refreshed.",
    value: (c) => c.lastUpdated,
  },
  {
    key: "sync_start",
    label: "Sync start",
    description: "How far back its history is synced.",
    value: (c) => c.startTime,
  },
  {
    key: "oldest_post",
    label: "Oldest stored post",
    description: "The oldest of its Posts this workspace keeps.",
    value: (c) => c.oldestStoredPostTimestamp,
  },
  {
    key: "next_regular_sync",
    label: "Next regular sync",
    description: "When its regular sync runs next.",
    value: (c) => c.nextRegularSyncAt,
  },
  {
    key: "next_dynamic_sync",
    label: "Next dynamic sync",
    description: "When its dynamic sync runs next.",
    value: (c) => c.nextDynamicSyncAt,
  },
  {
    key: "discovered_at",
    label: "Discovered",
    description: "When the forwarded Post that led you to it was published.",
    value: (c) => c.discoveredVia?.timestamp,
  },
]

const BY_KEY = new Map(CHANNEL_MOMENTS.map((m) => [m.key, m]))
export const channelMoment = (key: ChannelMomentKey) =>
  BY_KEY.get(key) as ChannelMoment
export const isChannelMomentKey = (key: string): key is ChannelMomentKey =>
  BY_KEY.has(key as ChannelMomentKey)
