import type { DiscoveryEmptyReason } from "@/lib/posts/discover-forward-sources"

export type DiscoveryQuickAction =
  | { type: "set_forwarded_filter"; value: "all" | "forwarded" }
  | { type: "go_to_tab"; tab: "channels" | "posts" }

export interface DiscoveryEmptyState {
  title: string
  body: string
  quickActions: { label: string; action: DiscoveryQuickAction }[]
}

const EMPTY_STATES: Record<
  Exclude<DiscoveryEmptyReason, "semantic_active">,
  DiscoveryEmptyState
> = {
  original_only: {
    title: "Original posts only",
    body: "Forward-source discovery needs posts with forward metadata. Switch to all posts or forwarded-only to see which channels your sources forward from.",
    quickActions: [
      {
        label: "Show all posts",
        action: { type: "set_forwarded_filter", value: "all" },
      },
      {
        label: "Show forwarded only",
        action: { type: "set_forwarded_filter", value: "forwarded" },
      },
    ],
  },
  no_channels_selected: {
    title: "No channels selected",
    body: "Select one or more channels on the Channels tab to discover forward sources in their posts.",
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
  no_forwards_in_scope: {
    title: "No forwarded posts in scope",
    body: "Your current scope has posts, but none are forwards. Show forwarded posts to discover new channels.",
    quickActions: [
      {
        label: "Show forwarded only",
        action: { type: "set_forwarded_filter", value: "forwarded" },
      },
    ],
  },
  no_unfollowed_sources: {
    title: "All forward sources already followed",
    body: "Every forward source in this scope is already in your channel list. Show all forwards to review followed sources too.",
    quickActions: [
      {
        label: "Show all forwards",
        action: { type: "set_forwarded_filter", value: "forwarded" },
      },
    ],
  },
}

export function resolveDiscoveryEmptyState(
  reason: DiscoveryEmptyReason | undefined,
): DiscoveryEmptyState | null {
  if (!reason || reason === "semantic_active") return null
  return EMPTY_STATES[reason]
}

export const FORWARDED_FILTER_LABELS: Record<string, string> = {
  all: "All posts",
  forwarded: "Forwarded only",
  original: "Original only",
  unfollowed_forwarded: "Unfollowed forwarded",
}
