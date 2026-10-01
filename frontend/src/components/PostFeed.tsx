import { Keyboard, LayoutGrid } from "lucide-react"
import { motion } from "motion/react"
import type React from "react"
import { useEffect, useState } from "react"
import {
  isSemanticFeed,
  useLiveWindowRefresh,
  usePostsFeed,
  useShownPostCounts,
} from "@/hooks/usePostsView"
import { feedSubtitle } from "@/lib/posts/post-filter-bar"
import { scopedSessionStorage } from "@/lib/storage/scoped"
import { cn } from "@/lib/utils"
import { useData } from "../contexts/DataContext"
import { useScraper } from "../contexts/ScraperContext"
import { useSettings } from "../contexts/SettingsContext"
import { PostFeedResults } from "./PostFeedResults"
import { PostFilter } from "./PostFilter"
import { pillClass } from "./PostFilterParts"
import {
  SpotlightBanner,
  SpotlightProvider,
  useSpotlightState,
} from "./post-card/ChannelSpotlight"
import { FeedKeyboard } from "./post-card/FeedKeyboard"

interface PostFeedProps {
  postSearch: string
  setPostSearch: (val: string) => void
  loadMoreRef: React.RefObject<HTMLDivElement | null>
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

/**
 * A switch that lasts for the browser session, per Account. Not in the
 * settings schema, which persists to local storage and the server: the Compact
 * grid and Keyboard switches must reset with a new session (spec story 32).
 */
function useSessionFlag(key: string): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => scopedSessionStorage.getItem(key) === "1")
  const set = (next: boolean) => {
    setOn(next)
    if (next) scopedSessionStorage.setItem(key, "1")
    else scopedSessionStorage.removeItem(key)
  }
  return [on, set]
}

export const PostFeed: React.FC<PostFeedProps> = ({
  postSearch,
  setPostSearch,
  loadMoreRef,
  scrollContainerRef,
}) => {
  const {
    maxPostsPerChannel,
    maxPostsPerChannelMode,
    postSortOrder,
    groupByChannel,
    invalidatePostViews,
    postFilter,
    semanticSearchQuery,
    relatedPostSearch,
  } = useScraper()
  const { embeddingsEnabled } = useSettings()
  const { channels } = useData()
  const spotlightApi = useSpotlightState(
    scrollContainerRef,
    postFilter,
    isSemanticFeed(embeddingsEnabled, relatedPostSearch, semanticSearchQuery),
  )
  const { spotlight } = spotlightApi
  const { posts, isInitialLoading, hasMore, loadMore, isLoadingMore } =
    usePostsFeed(spotlight)
  const [compact, setCompact] = useSessionFlag("postFeed_compactGrid")
  const [keyboard, setKeyboard] = useSessionFlag("postFeed_keyboard")
  const { counts, tooNewToJudge } = useShownPostCounts(spotlight)
  const totalInScope = Object.values(counts).reduce((sum, n) => sum + n, 0)

  // Posts is the surface a Live window is watched on, so it is the surface that
  // refreshes on the minute. Mounted here rather than in the feed hook so the
  // count above refreshes with it (AW-04).
  useLiveWindowRefresh(invalidatePostViews)

  // A spotlight drops the cap and grouping, so the subtitle names neither.
  const subtitle = spotlight
    ? ""
    : feedSubtitle(
        maxPostsPerChannel,
        maxPostsPerChannelMode,
        postSortOrder,
        groupByChannel,
      )

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
    <SpotlightProvider value={spotlightApi}>
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
          trailing={
            <>
              <button
                type="button"
                aria-pressed={compact}
                onClick={() => setCompact(!compact)}
                className={cn(pillClass(compact), "ml-auto")}
              >
                <LayoutGrid size={12} /> Compact grid
              </button>
              <button
                type="button"
                aria-pressed={keyboard}
                onClick={() => setKeyboard(!keyboard)}
                className={pillClass(keyboard)}
                title="j / k to move, an action's letter to fire it"
              >
                <Keyboard size={12} /> Keyboard
              </button>
            </>
          }
        />

        {spotlight && (
          <SpotlightBanner
            name={spotlight.channel}
            channel={channels.find(
              (c) => c.name.toLowerCase() === spotlight.channel.toLowerCase(),
            )}
            keepFilters={spotlight.keepFilters}
            onKeepFiltersChange={spotlightApi.setKeepFilters}
            onBack={spotlightApi.leave}
          />
        )}

        <PostFeedResults
          isInitialLoading={isInitialLoading}
          posts={posts}
          showLoadMore={hasMore || isLoadingMore}
          loadMoreRef={loadMoreRef}
          postSearch={postSearch}
          compact={compact}
          keyboard={keyboard}
        />
        <FeedKeyboard on={keyboard} />
      </motion.div>
    </SpotlightProvider>
  )
}
