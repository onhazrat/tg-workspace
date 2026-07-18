import { List, Loader2 } from "lucide-react"
import { motion } from "motion/react"
import type React from "react"
import { useEffect } from "react"
import { TgHeroEmptyState } from "@/components/ui/tg-segmented"
import { useScraper } from "../contexts/ScraperContext"
import { PostCard } from "./PostCard"
import { PostFilter } from "./PostFilter"
import { Skeleton } from "./ui/skeleton"

interface PostFeedProps {
  postSearch: string
  setPostSearch: (val: string) => void
  loadMoreRef: React.RefObject<HTMLDivElement | null>
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

export const PostFeed: React.FC<PostFeedProps> = ({
  postSearch,
  setPostSearch,
  loadMoreRef,
}) => {
  const {
    filteredPosts,
    isInitialPostLoadPending,
    visiblePosts,
    setVisiblePosts,
    maxPostsPerChannel,
    maxPostsPerChannelMode,
    postSortOrder,
  } = useScraper()

  const subtitleParts = [`${filteredPosts.length} posts in range`]
  if (maxPostsPerChannel > 0) {
    subtitleParts.push(
      `(max ${maxPostsPerChannel}/channel, ${maxPostsPerChannelMode})`,
    )
  }
  if (postSortOrder === "channel_time") {
    subtitleParts.push("(grouped by channel)")
  }
  const subtitle = subtitleParts.join(" ")

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisiblePosts((prev) => prev + 20)
        }
      },
      { threshold: 0.1 },
    )

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current)
    }

    return () => {
      if (loadMoreRef.current) {
        observer.unobserve(loadMoreRef.current)
      }
    }
  }, [loadMoreRef, setVisiblePosts])

  return (
    <motion.div
      key="posts"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 pb-10"
    >
      <PostFilter postSearch={postSearch} setPostSearch={setPostSearch} />

      <div className="flex items-center gap-3 mb-4 px-1">
        <div className="w-8 h-8 rounded-lg bg-app-muted flex items-center justify-center border border-app-ink/10">
          <List size={16} className="opacity-60" />
        </div>
        <div>
          <h2 className="text-xs uppercase font-bold tracking-widest leading-none">
            Selected Posts
          </h2>
          <p className="text-[10px] font-mono opacity-50 mt-1">{subtitle}</p>
        </div>
      </div>

      {isInitialPostLoadPending ? (
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
      ) : filteredPosts.length > 0 ? (
        <div className="space-y-4">
          {filteredPosts.slice(0, visiblePosts).map((post) => (
            <PostCard
              key={`${post.channelName}-${post.id}`}
              post={post}
              postSearch={postSearch}
            />
          ))}

          {/* Load More Indicator */}
          {filteredPosts.length > visiblePosts && (
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
      )}
    </motion.div>
  )
}
