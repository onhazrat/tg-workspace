import { List, Loader2 } from "lucide-react"
import type React from "react"
import { TgHeroEmptyState } from "@/components/ui/tg-segmented"
import type { Post } from "@/types"
import { PostCard } from "./PostCard"
import { postCardKey } from "./post-card/FeedKeyboard"
import { Skeleton } from "./ui/skeleton"

/** As many 22rem columns as fit, in feed order left to right. */
const COMPACT_GRID =
  "grid grid-cols-[repeat(auto-fill,minmax(min(22rem,100%),1fr))] gap-3"

const bar = (className: string, key?: string) => (
  <Skeleton key={key} className={`bg-app-ink/10 ${className}`} />
)

/** A Post's text: lines of these widths, the last one short. */
const lines = (widths: string[]) => (
  <div className="space-y-2">{widths.map((w) => bar(`h-3 ${w}`, w))}</div>
)

/**
 * The first load's placeholders, in the shape of the cards that will load
 * (RCH-01): the Compact grid's small cards, a photo on every third, or full
 * cards, a photo on every other.
 */
function PostSkeletons({ compact }: { compact: boolean }) {
  if (compact)
    return (
      <div className={COMPACT_GRID}>
        {Array.from({ length: 9 }, (_, i) => (
          <div
            key={`post-skeleton-${i}`}
            className="flex flex-col gap-2 rounded-xl border border-app-ink/10 bg-app-card px-4 pt-3 pb-1.5"
          >
            <div className="flex items-center gap-2">
              {bar("size-6 rounded-full")}
              {bar("h-3 w-24")}
              {bar("h-3 w-10")}
              {bar("ml-auto size-4 rounded")}
            </div>
            {i % 3 === 1 && bar("mx-auto h-32 w-3/4 rounded-lg")}
            {lines(["w-full", "w-[92%]", "w-[60%]"])}
            <div className="mt-auto flex items-center gap-3 border-t border-app-ink/5 pt-1.5">
              {bar("h-3 w-10")}
              {bar("h-3 w-8")}
              {bar("ml-auto h-3 w-16")}
            </div>
          </div>
        ))}
      </div>
    )
  return (
    <div className="space-y-4">
      {Array.from({ length: 4 }, (_, i) => (
        <div
          key={`post-skeleton-${i}`}
          className="overflow-hidden rounded-2xl border border-app-ink/10 bg-app-card shadow-sm"
        >
          <div className="flex items-start gap-3 px-5 pt-4">
            {bar("size-9 rounded-full")}
            <div className="flex-1 space-y-2 pt-0.5">
              {bar("h-3.5 w-36")}
              {bar("h-3 w-28")}
            </div>
            {bar("mt-1 size-4 rounded")}
          </div>
          {i % 2 === 1 && (
            <div className="mt-3 px-5">
              {bar("mx-auto h-56 w-2/3 rounded-lg")}
            </div>
          )}
          <div className="px-5 pt-3 pb-3">
            {lines(["w-full", "w-[92%]", "w-[85%]", "w-[55%]"])}
          </div>
          <div className="flex items-center gap-3 border-t border-app-ink/5 px-5 py-2">
            {bar("h-3 w-12")}
            {bar("h-3 w-16")}
            {bar("ml-auto h-3 w-24")}
          </div>
        </div>
      ))}
    </div>
  )
}

interface PostFeedResultsProps {
  isInitialLoading: boolean
  posts: Post[]
  /** More pages exist or one is loading; mounts the scroll sentinel. */
  showLoadMore: boolean
  loadMoreRef: React.RefObject<HTMLDivElement | null>
  postSearch: string
  /** Lay the cards out as the Compact grid. */
  compact?: boolean
  /** Keyboard mode's Highlight: the card's `data-post-key`. */
  highlight?: string | null
  /** Tick or untick a Post (PTR-05). */
  onToggleSelected: (post: Post, shift: boolean) => void
}

/** The feed below the filter: loading skeletons, the post list, or the empty state. */
export const PostFeedResults: React.FC<PostFeedResultsProps> = ({
  isInitialLoading,
  posts,
  showLoadMore,
  loadMoreRef,
  postSearch,
  compact = false,
  highlight = null,
  onToggleSelected,
}) =>
  isInitialLoading ? (
    <PostSkeletons compact={compact} />
  ) : posts.length > 0 ? (
    <div className={compact ? COMPACT_GRID : "space-y-4"}>
      {posts.map((post) => (
        <PostCard
          key={`${post.channelName}-${post.id}`}
          post={post}
          postSearch={postSearch}
          compact={compact}
          highlighted={highlight === postCardKey(post)}
          onToggleSelected={onToggleSelected}
        />
      ))}

      {/* Load More Indicator */}
      {showLoadMore && (
        <div
          ref={loadMoreRef}
          className="col-span-full h-32 flex flex-col items-center justify-center gap-4 opacity-60"
        >
          <div className="w-10 h-10 rounded-full bg-app-card shadow-sm border border-app-ink/10 flex items-center justify-center">
            <Loader2 size={18} className="animate-spin text-app-ink/60" />
          </div>
          <span className="text-[10px] font-mono uppercase tracking-widest text-app-ink/60">
            Loading more posts...
          </span>
        </div>
      )}
    </div>
  ) : (
    /* Empty State */
    <TgHeroEmptyState
      className="h-full max-w-md mx-auto"
      icon={<List size={28} className="opacity-40" />}
      title="No Posts in Range"
      description="Try adjusting your filtration parameters, clearing your search query, or adding more channels to your selection."
    />
  )
