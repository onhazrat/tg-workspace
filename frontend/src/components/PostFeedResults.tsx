import { List, Loader2 } from "lucide-react"
import type React from "react"
import { TgHeroEmptyState } from "@/components/ui/tg-segmented"
import type { Post } from "@/types"
import { PostCard } from "./PostCard"
import { Skeleton } from "./ui/skeleton"

interface PostFeedResultsProps {
  isInitialLoading: boolean
  posts: Post[]
  /** More pages exist or one is loading; mounts the scroll sentinel. */
  showLoadMore: boolean
  loadMoreRef: React.RefObject<HTMLDivElement | null>
  postSearch: string
}

/** The feed below the filter: loading skeletons, the post list, or the empty state. */
export const PostFeedResults: React.FC<PostFeedResultsProps> = ({
  isInitialLoading,
  posts,
  showLoadMore,
  loadMoreRef,
  postSearch,
}) =>
  isInitialLoading ? (
    <div className="space-y-4">
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={`post-skeleton-${index}`}
          className="rounded-xl border border-app-ink/10 bg-app-card p-5"
        >
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full bg-app-ink/10" />
              <div className="space-y-2">
                <Skeleton className="h-3 w-28 bg-app-ink/10" />
                <Skeleton className="h-3 w-20 bg-app-ink/10" />
              </div>
            </div>
            <Skeleton className="h-6 w-20 rounded-full bg-app-ink/10" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-full bg-app-ink/10" />
            <Skeleton className="h-3 w-[92%] bg-app-ink/10" />
            <Skeleton className="h-3 w-[85%] bg-app-ink/10" />
            <Skeleton className="h-3 w-[70%] bg-app-ink/10" />
          </div>
        </div>
      ))}
    </div>
  ) : posts.length > 0 ? (
    <div className="space-y-4">
      {posts.map((post) => (
        <PostCard
          key={`${post.channelName}-${post.id}`}
          post={post}
          postSearch={postSearch}
        />
      ))}

      {/* Load More Indicator */}
      {showLoadMore && (
        <div
          ref={loadMoreRef}
          className="h-32 flex flex-col items-center justify-center gap-4 opacity-60"
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
