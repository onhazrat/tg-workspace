import { List } from "lucide-react"
import { motion } from "motion/react"
import type React from "react"
import { useEffect } from "react"
import {
  useLiveWindowRefresh,
  usePostsFeed,
  useScopedPostCounts,
} from "@/hooks/usePostsView"
import { useScraper } from "../contexts/ScraperContext"
import { PostFeedResults } from "./PostFeedResults"
import { PostFilter } from "./PostFilter"

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
    maxPostsPerChannel,
    maxPostsPerChannelMode,
    postSortOrder,
    invalidatePostViews,
  } = useScraper()
  const { posts, isInitialLoading, hasMore, loadMore, isLoadingMore } =
    usePostsFeed()
  const counts = useScopedPostCounts()
  const totalInScope = Object.values(counts).reduce((sum, n) => sum + n, 0)

  // Posts is the surface a Live window is watched on, so it is the surface that
  // refreshes on the minute. Mounted here rather than in the feed hook so the
  // count above refreshes with it (AW-04).
  useLiveWindowRefresh(invalidatePostViews)

  const subtitleParts = [`${totalInScope} posts in range`]
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
          loadMore()
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
  }, [loadMoreRef, loadMore])

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

      <PostFeedResults
        isInitialLoading={isInitialLoading}
        posts={posts}
        showLoadMore={hasMore || isLoadingMore}
        loadMoreRef={loadMoreRef}
        postSearch={postSearch}
      />
    </motion.div>
  )
}
