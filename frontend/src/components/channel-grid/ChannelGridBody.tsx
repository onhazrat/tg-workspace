import { Send } from "lucide-react"
import type React from "react"
import { VirtualizedChannelGrid } from "@/components/channel-grid/VirtualizedChannelGrid"
import { Skeleton } from "@/components/ui/skeleton"
import { channelGridCountLabel } from "@/lib/channels/grid-count-label"
import type { Channel } from "@/types"

type ChannelGridBodyProps = {
  isLoading: boolean
  totalChannelCount: number
  filteredChannelCount: number
  channels: Channel[]
  visibleCount: number
  showSortRank: boolean
  selectedChannels: Set<string>
  selectedTrimRanks: Map<string, number>
  /** Per-channel in-scope post counts, shared from one query in ChannelGrid. */
  postsInScopeCounts: Record<string, number>
  onRemoveChannel: (channel: Channel) => void
  onResetAndSync: (channel: Channel) => void
  hasMore: boolean
  /** Loads the next page; called when the last virtual row comes into range. */
  onLoadMore: () => void
  /** The workspace scroll container the grid is windowed against. */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

/** Grid body: loading skeletons, empty state, or the ChannelCard grid with infinite-scroll sentinel. */
export const ChannelGridBody: React.FC<ChannelGridBodyProps> = ({
  isLoading,
  totalChannelCount,
  filteredChannelCount,
  channels,
  visibleCount,
  showSortRank,
  selectedChannels,
  selectedTrimRanks,
  postsInScopeCounts,
  onRemoveChannel,
  onResetAndSync,
  hasMore,
  onLoadMore,
  scrollContainerRef,
}) => {
  if (isLoading) {
    return (
      <div
        className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        id="tour-channel-grid"
      >
        {Array.from({ length: 8 }).map((_, index) => (
          <div
            key={`channel-skeleton-${index}`}
            className="rounded-2xl border border-app-ink/10 bg-app-card p-5"
          >
            <div className="mb-4 flex items-start gap-4">
              <Skeleton className="h-14 w-14 rounded-full bg-app-ink/10" />
              <div className="flex-1 space-y-2 pt-1">
                <Skeleton className="h-4 w-3/4 bg-app-ink/10" />
                <Skeleton className="h-3 w-1/2 bg-app-ink/10" />
              </div>
            </div>
            <div className="mb-5 flex flex-wrap gap-2">
              <Skeleton className="h-6 w-24 bg-app-ink/10" />
              <Skeleton className="h-6 w-20 bg-app-ink/10" />
              <Skeleton className="h-6 w-28 bg-app-ink/10" />
            </div>
            <div className="mt-6 flex items-center justify-between border-t border-app-ink/5 pt-4">
              <Skeleton className="h-8 w-28 bg-app-ink/10" />
              <Skeleton className="h-8 w-20 bg-app-ink/10" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (filteredChannelCount === 0) {
    return (
      <div
        id="tour-channel-grid"
        className="flex flex-col items-center justify-center py-20 px-4 text-center border border-dashed border-app-ink/20 rounded-2xl bg-app-muted/5"
      >
        <div className="w-20 h-20 bg-app-ink/5 rounded-full flex items-center justify-center mb-6 border border-app-ink/10">
          <Send size={32} className="opacity-20" />
        </div>
        <h3 className="text-xl font-bold mb-2 text-app-ink">
          No Channels Found
        </h3>
        <p className="text-sm opacity-60 max-w-md mx-auto mb-8">
          {totalChannelCount === 0
            ? "Start by adding a Telegram channel username above. We'll fetch its details and you can begin syncing posts immediately."
            : "No channels match your search."}
        </p>
      </div>
    )
  }

  const countLabel = channelGridCountLabel({
    shown: Math.min(visibleCount, channels.length),
    filtered: filteredChannelCount,
    total: totalChannelCount,
  })

  return (
    <>
      <VirtualizedChannelGrid
        channels={channels.slice(0, visibleCount)}
        scrollContainerRef={scrollContainerRef}
        postsInScopeCounts={postsInScopeCounts}
        showSortRank={showSortRank}
        selectedChannels={selectedChannels}
        selectedTrimRanks={selectedTrimRanks}
        onRemoveChannel={onRemoveChannel}
        onResetAndSync={onResetAndSync}
        hasMore={hasMore}
        onLoadMore={onLoadMore}
      />

      {/* Kept as a position marker for tests and as the visual end-of-list
          spacer. It no longer drives loading — the virtualizer does, because an
          observer on this element stopped firing once the grid above it took an
          explicit, changing height. */}
      {hasMore && (
        <div data-testid="channel-grid-load-more" className="h-10 w-full" />
      )}

      {countLabel && (
        <p
          data-testid="channel-grid-count"
          className="mt-2 text-center text-[11px] font-mono uppercase tracking-widest text-app-ink/40"
        >
          {countLabel}
        </p>
      )}
    </>
  )
}
