import { useVirtualizer } from "@tanstack/react-virtual"
import type React from "react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ChannelCard } from "@/components/ChannelCard"
import { gridLanesForWidth } from "@/lib/channels/grid-lanes"
import type { Channel } from "@/types"

/**
 * Windowed channel grid.
 *
 * The grid used to append cards on scroll and never unmount them: 20 cards cost
 * ~1,440 DOM nodes, and a real account holds ~1,070 channels, so scrolling to
 * the end mounted tens of thousands of nodes with roughly a dozen interactive
 * elements per card. Only rows near the viewport are mounted now, so DOM size is
 * bounded by the viewport rather than by how far the user has scrolled.
 *
 * Three things make this the awkward case for virtualization, each handled
 * explicitly below: the scroll container lives *outside* this component and is
 * shared with the rest of the workspace; the column count is responsive; and
 * card heights vary with bio and tag content, so rows must be measured.
 */

type VirtualizedChannelGridProps = {
  channels: Channel[]
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  postsInScopeCounts: Record<string, number>
  showSortRank: boolean
  selectedChannels: Set<string>
  selectedTrimRanks: Map<string, number>
  onRemoveChannel: (channel: Channel) => void
  onResetAndSync: (channel: Channel) => void
}

/** Matches the `gap-4` the grid used. */
const GAP_PX = 16
/** Starting row height; measured heights replace this as rows mount. */
const ESTIMATED_ROW_PX = 360
/**
 * Rows kept mounted beyond the viewport.
 *
 * Deliberately generous. Beyond smoothing scrolling, it keeps a workable number
 * of cards reachable to anything that locates them by `[data-channel-name]`
 * without scrolling first — which is how the command palette's channel actions
 * and much of the e2e suite find cards.
 */
const OVERSCAN_ROWS = 6

export const VirtualizedChannelGrid: React.FC<VirtualizedChannelGridProps> = ({
  channels,
  scrollContainerRef,
  postsInScopeCounts,
  showSortRank,
  selectedChannels,
  selectedTrimRanks,
  onRemoveChannel,
  onResetAndSync,
}) => {
  const gridRef = useRef<HTMLDivElement>(null)
  const [lanes, setLanes] = useState(() =>
    gridLanesForWidth(typeof window === "undefined" ? 1280 : window.innerWidth),
  )
  /**
   * Distance from the top of the scroll container to the top of the grid — the
   * filter bar sits above it, so this is not zero. Held in state rather than
   * read from the ref during render, where it would be stale on the first pass
   * and would never update when the bar above changes height.
   */
  const [scrollMargin, setScrollMargin] = useState(0)

  // Track the grid's own width, not the window's: the workspace has a sidebar,
  // so the two disagree and the column count follows the container.
  useLayoutEffect(() => {
    const element = gridRef.current
    if (!element) return

    const apply = () => {
      setLanes(gridLanesForWidth(element.clientWidth))
      setScrollMargin(element.offsetTop)
    }
    apply()

    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(apply)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const rowCount = Math.ceil(channels.length / lanes)

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ESTIMATED_ROW_PX + GAP_PX,
    overscan: OVERSCAN_ROWS,
    scrollMargin,
  })

  // Row heights depend on the column count, so a breakpoint change invalidates
  // every measurement taken at the previous width.
  //
  // Keyed on `lanes` alone: `virtualizer` is a fresh object every render, so
  // depending on it would re-measure each render, and each measure re-renders —
  // a loop that hangs the page under scroll.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    virtualizer.measure()
  }, [lanes])

  const virtualRows = virtualizer.getVirtualItems()

  return (
    <div
      ref={gridRef}
      id="tour-channel-grid"
      style={{ height: virtualizer.getTotalSize(), position: "relative" }}
    >
      {virtualRows.map((virtualRow) => {
        const start = virtualRow.index * lanes
        const rowChannels = channels.slice(start, start + lanes)

        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${
                virtualRow.start - virtualizer.options.scrollMargin
              }px)`,
            }}
          >
            <div
              className="grid gap-4 pb-4"
              style={{
                gridTemplateColumns: `repeat(${lanes}, minmax(0, 1fr))`,
              }}
            >
              {rowChannels.map((channel) => (
                <ChannelCard
                  key={channel.id}
                  channel={channel}
                  inScopeCount={postsInScopeCounts[channel.name] ?? 0}
                  handleRemoveChannel={onRemoveChannel}
                  handleResetAndSync={onResetAndSync}
                  sortRank={
                    showSortRank && selectedChannels.has(channel.name)
                      ? selectedTrimRanks.get(channel.name)
                      : undefined
                  }
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
