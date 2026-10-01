/**
 * The Channel spotlight (PTR-04): one Channel's Posts alone, a detour from
 * the feed rather than a new place.
 *
 * It never writes the Account's Post filter. While it is on, the tab shows
 * and edits the spotlight's own tree, a single Channel Condition, or that
 * Condition joined with AND to the Account's filter when "Keep my filters" is
 * on. Leaving drops the spotlight, so the filter that was there is the filter
 * that is there, whatever was edited in between. Nor does it reach the Scope:
 * the cap, the grouping and the keyword it drops are dropped from the feed's
 * request only, and an Action submitted during one covers what it would have
 * without it.
 */

import { newId } from "@/lib/filter-tree"
import { isEmptyPostFilter, type PostFilter } from "@/lib/posts/post-filter"

export interface ChannelSpotlight {
  channel: string
  keepFilters: boolean
  /** The tree the tab shows and edits while the spotlight is on. */
  filter: PostFilter
  /** The `data-post-key` of the card it started from, to scroll back to. */
  from: string
}

/** The Channel Condition alone, or joined with AND to the Account's filter. */
export function spotlightFilter(
  channel: string,
  keepFilters: boolean,
  accountFilter: PostFilter,
): PostFilter {
  const only: PostFilter = {
    kind: "group",
    id: "root",
    op: "and",
    children: [
      { kind: "atom", id: newId(), cond: { type: "channel", value: channel } },
    ],
  }
  if (!keepFilters || isEmptyPostFilter(accountFilter)) return only
  // An AND root's blocks join the Condition as they are; anything else goes
  // in as one block, its operator and NOT kept.
  const kept =
    accountFilter.op === "and" && !accountFilter.not
      ? accountFilter.children
      : [{ ...accountFilter, id: newId() }]
  return { ...only, children: [...only.children, ...kept] }
}

/**
 * Spotlight `channel`. From inside a spotlight (a forward's source) it keeps
 * the card the first one started from, and whether filters are kept.
 */
export function enterSpotlight(
  current: ChannelSpotlight | null,
  channel: string,
  from: string,
  accountFilter: PostFilter,
): ChannelSpotlight {
  const keepFilters = current?.keepFilters ?? false
  return {
    channel,
    keepFilters,
    filter: spotlightFilter(channel, keepFilters, accountFilter),
    from: current?.from ?? from,
  }
}

export const keepSpotlightFilters = (
  spotlight: ChannelSpotlight,
  keepFilters: boolean,
  accountFilter: PostFilter,
): ChannelSpotlight => ({
  ...spotlight,
  keepFilters,
  filter: spotlightFilter(spotlight.channel, keepFilters, accountFilter),
})

/** The tree the tab shows: the spotlight's while one is on. */
export const shownPostFilter = (
  spotlight: ChannelSpotlight | null,
  accountFilter: PostFilter,
): PostFilter => spotlight?.filter ?? accountFilter

/** What the feed and its counts read: the Channels, the keyword, the tree, the cap and grouping. */
export interface PostsView {
  channelNames: string[]
  keyword: string
  filter: PostFilter
  maxPerChannel: number
  groupByChannel: boolean
}

/**
 * The view under a spotlight: its Channel and tree, no cap, no grouping, and
 * the keyword only when the filters are kept.
 */
export function spotlightView(
  spotlight: ChannelSpotlight | null,
  view: PostsView,
): PostsView {
  if (!spotlight) return view
  return {
    channelNames: [spotlight.channel],
    keyword: spotlight.keepFilters ? view.keyword : "",
    filter: spotlight.filter,
    maxPerChannel: 0,
    groupByChannel: false,
  }
}
