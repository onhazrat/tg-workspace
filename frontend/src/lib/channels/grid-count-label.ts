/**
 * "Showing X of Y" for the channel grid.
 *
 * The grid renders 20 cards and grows on scroll, with no indication of how much
 * more there is — at ~1,070 channels you cannot tell whether you are looking at
 * everything or at a slice. Both counts were already plumbed into the grid body;
 * they were simply never displayed.
 */

export interface ChannelGridCounts {
  /** Cards actually rendered right now. */
  shown: number
  /** Channels matching the active filter. */
  filtered: number
  /** Channels in the account, ignoring filters. */
  total: number
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/**
 * Label for the grid footer, or `null` when there is nothing worth saying —
 * an empty grid has its own empty state, and a fully-visible unfiltered grid
 * does not need a count.
 */
export function channelGridCountLabel(
  counts: ChannelGridCounts,
): string | null {
  const { shown, filtered, total } = counts
  if (filtered === 0) return null

  const isFiltered = filtered < total
  const allShown = shown >= filtered

  if (!isFiltered && allShown) return null

  if (!isFiltered) {
    return `Showing ${shown} of ${plural(filtered, "channel")}`
  }

  const scope = allShown
    ? `${plural(filtered, "channel")} matching`
    : `Showing ${shown} of ${plural(filtered, "channel")} matching`
  return `${scope} · ${total} total`
}
