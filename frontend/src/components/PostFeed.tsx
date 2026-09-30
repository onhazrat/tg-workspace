import { motion } from "motion/react"
import type React from "react"
import { useEffect } from "react"
import {
  useLiveWindowRefresh,
  usePostsFeed,
  useScopedPostCounts,
} from "@/hooks/usePostsView"
import type {
  MaxPostsPerChannelMode,
  PostSortOrder,
} from "@/lib/posts/post-view"
import { useScraper } from "../contexts/ScraperContext"
import { PostFeedResults } from "./PostFeedResults"
import { PostFilter } from "./PostFilter"

interface PostFeedProps {
  postSearch: string
  setPostSearch: (val: string) => void
  loadMoreRef: React.RefObject<HTMLDivElement | null>
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

/**
 * The cap mode as the subtitle names it. `ordered` is named for the order it
 * follows, so it still reads "latest" under newest first, as it did (PFB-01).
 */
function capModeLabel(
  mode: MaxPostsPerChannelMode,
  order: PostSortOrder,
): string {
  if (mode === "random") return "random"
  return order === "oldest" ? "earliest" : "latest"
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
    groupByChannel,
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

  // What the footer adds after the count: the cap and grouping, as the
  // subtitle always said them.
  const subtitleParts: string[] = []
  if (maxPostsPerChannel > 0) {
    subtitleParts.push(
      `(max ${maxPostsPerChannel}/channel, ${capModeLabel(maxPostsPerChannelMode, postSortOrder)})`,
    )
  }
  if (groupByChannel) {
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
      <PostFilter
        postSearch={postSearch}
        setPostSearch={setPostSearch}
        shownCount={totalInScope}
        subtitle={subtitle}
      />

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
