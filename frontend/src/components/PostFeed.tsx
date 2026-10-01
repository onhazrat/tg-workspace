import { motion } from "motion/react"
import type React from "react"
import { useEffect } from "react"
import { PostFilterTreeProvider } from "@/contexts/PostFilterTreeContext"
import type { ChannelFocus } from "@/hooks/usePostsView"
import {
  useLiveWindowRefresh,
  usePostsFeed,
  useScopedPostCounts,
  useTooNewToJudge,
} from "@/hooks/usePostsView"
import type {
  MaxPostsPerChannelMode,
  PostSortOrder,
} from "@/lib/posts/post-view"
import { useScraper } from "../contexts/ScraperContext"
import { PostFeedResults } from "./PostFeedResults"
import { PostFilter } from "./PostFilter"
import { PrototypeSwitcher } from "./PrototypeSwitcher"
import {
  CARD_VARIANTS,
  ChannelFocusBanner,
  ChannelFocusProvider,
  FeedKeyboard,
  FeedModeToggles,
  FeedPrefsProvider,
} from "./post-card/PostCardPrototype"
import {
  PostSelectionBar,
  PostSelectionProvider,
  useFilterBarOverride,
  useSelectionFeed,
  useTreeFilter,
} from "./post-card/PostSelectionPrototype"
import { useViewsMaxFilter } from "./post-card/ViewsFilterPrototype"

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
  if (order === "most_views") return "top by views"
  if (order === "fewest_views") return "bottom by views"
  return order === "oldest" ? "earliest" : "latest"
}

// PROTOTYPE (post-card): the focus state wraps the feed so cards can set it.
export const PostFeed: React.FC<PostFeedProps> = (props) => (
  <FeedPrefsProvider>
    <PostFilterTreeProvider>
      <PostSelectionProvider>
        <ChannelFocusProvider scrollContainerRef={props.scrollContainerRef}>
          {(focus) => <PostFeedInner {...props} focus={focus} />}
        </ChannelFocusProvider>
      </PostSelectionProvider>
    </PostFilterTreeProvider>
  </FeedPrefsProvider>
)

const PostFeedInner: React.FC<
  PostFeedProps & { focus: ChannelFocus | null }
> = ({ postSearch, setPostSearch, loadMoreRef, focus }) => {
  const {
    maxPostsPerChannel,
    maxPostsPerChannelMode,
    postSortOrder,
    groupByChannel,
    invalidatePostViews,
  } = useScraper()
  const { posts, isInitialLoading, hasMore, loadMore, isLoadingMore } =
    usePostsFeed(focus)
  // PROTOTYPE (post-card): A-plus-* filter bar, its browser-side upper bound,
  // and A-plus-select's tree, both run on the loaded pages.
  const unfocused = focus != null && !focus.keepFilters
  const boundedPosts = useViewsMaxFilter(posts, unfocused)
  const tree = useTreeFilter(boundedPosts, unfocused)
  const shownPosts = tree.posts
  const filterBarOverride = useFilterBarOverride({
    before: boundedPosts.length,
    shown: shownPosts.length,
  })
  // PROTOTYPE (post-card): A-plus-select can list the Selection first.
  const selectionFeed = useSelectionFeed(shownPosts)
  const counts = useScopedPostCounts()
  const tooNewToJudge = useTooNewToJudge()
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
        tooNewToJudge={tooNewToJudge}
        trailing={<FeedModeToggles />}
        override={filterBarOverride}
      />

      <ChannelFocusBanner />
      <PostSelectionBar />

      <PostFeedResults
        isInitialLoading={isInitialLoading}
        posts={selectionFeed}
        showLoadMore={hasMore || isLoadingMore}
        loadMoreRef={loadMoreRef}
        postSearch={postSearch}
      />
      <FeedKeyboard />
      <PrototypeSwitcher variants={CARD_VARIANTS} />
    </motion.div>
  )
}
