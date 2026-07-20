import type { DiscoveryEmptyReason } from "@/lib/posts/discover-candidates"

export type DiscoveryQuickAction =
  | { type: "set_forwarded_filter"; value: "all" | "forwarded" }
  | { type: "go_to_tab"; tab: "channels" | "posts" }
  | { type: "enable_all_signals" }
  | { type: "reset_candidate_filters" }

export interface DiscoveryEmptyState {
  title: string
  body: string
  quickActions: { label: string; action: DiscoveryQuickAction }[]
}

const EMPTY_STATES: Record<DiscoveryEmptyReason, DiscoveryEmptyState> = {
  no_signals_enabled: {
    title: "No discovery signals enabled",
    body: "Turn on at least one of Forwards, Mentions, or Links to find candidate channels.",
    quickActions: [
      { label: "Enable all signals", action: { type: "enable_all_signals" } },
    ],
  },
  no_channels_selected: {
    title: "No channels selected",
    body: "Select one or more channels on the Channels tab to discover new channels from their posts.",
    quickActions: [
      {
        label: "Go to Channels",
        action: { type: "go_to_tab", tab: "channels" },
      },
    ],
  },
  no_posts_in_scope: {
    title: "No posts in scope",
    body: "Widen the date range, clear keyword search, or adjust filters on the Posts tab to include more posts.",
    quickActions: [
      { label: "Go to Posts", action: { type: "go_to_tab", tab: "posts" } },
    ],
  },
  original_only: {
    title: "Original posts only",
    body: "Forward discovery needs posts with forward metadata, and the Posts tab is filtered to originals. Show all posts, or enable the Mentions and Links signals to discover from original posts too.",
    quickActions: [
      {
        label: "Show all posts",
        action: { type: "set_forwarded_filter", value: "all" },
      },
      { label: "Enable all signals", action: { type: "enable_all_signals" } },
    ],
  },
  no_candidates: {
    title: "No channels referenced in scope",
    body: "These posts don't forward from, mention, or link to any other channel. Try widening the date range or enabling more discovery signals.",
    quickActions: [
      { label: "Enable all signals", action: { type: "enable_all_signals" } },
      {
        label: "Show all posts",
        action: { type: "set_forwarded_filter", value: "all" },
      },
    ],
  },
  no_matching_candidates: {
    title: "No candidates match your filters",
    body: "Channels were found, but the follow-state, minimum-count, or name filters excluded all of them.",
    quickActions: [
      {
        label: "Reset filters",
        action: { type: "reset_candidate_filters" },
      },
    ],
  },
}

export function resolveDiscoveryEmptyState(
  reason: DiscoveryEmptyReason | undefined,
): DiscoveryEmptyState | null {
  if (!reason) return null
  return EMPTY_STATES[reason]
}

export const FORWARDED_FILTER_LABELS: Record<string, string> = {
  all: "All posts",
  forwarded: "Forwarded only",
  original: "Original only",
  unfollowed_forwarded: "Unfollowed forwarded",
}
