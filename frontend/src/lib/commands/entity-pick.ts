/**
 * What picking an item in the palette's entity list does, decided without
 * running anything. `useEntityFlow.handlePick` performs the answer.
 *
 * The order is the one the flows have always been checked in: the flows whose
 * value is not a channel name first, then setting groups, then everything else
 * resolves a channel by name.
 */
import type {
  Channel,
  ChannelSettingGroup,
  Post,
  SummaryListItem,
} from "@/types"
import {
  findPostByEntityId,
  isSettingGroupEntityFlow,
} from "./entity-candidates"
import type { EntityFlowType } from "./types"

export type PickResolution =
  /** The picked value names nothing that still exists. */
  | { kind: "ignore" }
  /** Ask first; the command runs from the confirm view with this payload. */
  | { kind: "confirm"; payload: unknown }
  /** Run the command, then the ordinary finish (records, closes). */
  | { kind: "run-then-finish"; payload: unknown }
  /** Run the command, record the pick, close — no stay-open follow-up. */
  | { kind: "run-then-close"; payload: unknown }
  /** Take the tag off the channel the previous step chose. */
  | { kind: "remove-tag"; channel: Channel; tag: string }
  /** Finish with the value as the payload; the command itself reads it. */
  | { kind: "finish-with"; value: string }
  /** A channel flow: chained steps, then the channel action. */
  | { kind: "channel"; channel: Channel }

/** Channel flows that ask before running when the command says to. */
const CONFIRMED_CHANNEL_FLOWS = new Set<EntityFlowType>([
  "delete-channel",
  "reset-sync-channel",
  "fix-partial-history-channel",
])

export interface PickSources {
  channels: Channel[]
  summaries: SummaryListItem[]
  settingGroups: ChannelSettingGroup[]
  /** The pick-post flow's pool, fetched when that flow opened. */
  posts: Post[]
  /** What the previous step handed this one (the channel, for remove-tag-pick). */
  payload: unknown
}

export function resolvePick(
  flow: EntityFlowType,
  value: string,
  requiresConfirmation: boolean,
  sources: PickSources,
): PickResolution {
  const ignore: PickResolution = { kind: "ignore" }
  const runOrConfirm = (payload: unknown): PickResolution =>
    requiresConfirmation
      ? { kind: "confirm", payload }
      : { kind: "run-then-finish", payload }

  switch (flow) {
    case "remove-tag-pick": {
      const channel = sources.payload as Channel | undefined
      return channel ? { kind: "remove-tag", channel, tag: value } : ignore
    }
    case "delete-summary": {
      const summary = sources.summaries.find((s) => s.id === value)
      return summary ? runOrConfirm(summary) : ignore
    }
    case "pick-post": {
      const post = findPostByEntityId(sources.posts, value)
      return post ? { kind: "run-then-close", payload: post } : ignore
    }
    case "clear-db-table":
      return runOrConfirm(value)
    case "open-configuration":
      return { kind: "finish-with", value }
  }

  if (isSettingGroupEntityFlow(flow)) {
    const exists = sources.settingGroups.some((g) => g.id === value)
    return exists ? { kind: "run-then-finish", payload: value } : ignore
  }

  const channel = sources.channels.find((c) => c.name === value)
  if (!channel) return ignore
  if (requiresConfirmation && CONFIRMED_CHANNEL_FLOWS.has(flow))
    return { kind: "confirm", payload: channel }
  return { kind: "channel", channel }
}
