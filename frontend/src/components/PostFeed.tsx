import { Keyboard, LayoutGrid } from "lucide-react"
import { motion } from "motion/react"
import type React from "react"
import { useEffect, useRef, useState } from "react"
import {
  isSemanticFeed,
  useLiveWindowRefresh,
  usePostFacets,
  usePostsFeed,
  useScopedPostCounts,
  useShownPostCounts,
} from "@/hooks/usePostsView"
import { spotlightView } from "@/lib/posts/channel-spotlight"
import { feedSubtitle } from "@/lib/posts/post-filter-bar"
import {
  pick,
  postKey,
  rule,
  runPicks,
  selectionChips,
  snapshotOf,
} from "@/lib/posts/post-selection"
import { scopedSessionStorage } from "@/lib/storage/scoped"
import { cn } from "@/lib/utils"
import { useData } from "../contexts/DataContext"
import { useScraper } from "../contexts/ScraperContext"
import { useSettings } from "../contexts/SettingsContext"
import { PostFeedResults } from "./PostFeedResults"
import { PostFilter } from "./PostFilter"
import { pillClass } from "./PostFilterParts"
import { PostSelectionBar } from "./PostSelectionBar"
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
    viewMeasure,
    postSelection,
    appendSelection,
    removeSelectionChip,
  } = useScraper()
  const { embeddingsEnabled } = useSettings()
  const { channels, selectedChannels } = useData()
  const ranked = isSemanticFeed(
    embeddingsEnabled,
    relatedPostSearch,
    semanticSearchQuery,
  )
  const spotlightApi = useSpotlightState(scrollContainerRef, postFilter, ranked)
  const { spotlight } = spotlightApi
  const { posts, isInitialLoading, hasMore, loadMore, isLoadingMore } =
    usePostsFeed(spotlight)
  const [compact, setCompact] = useSessionFlag("postFeed_compactGrid")
  const [keyboard, setKeyboard] = useSessionFlag("postFeed_keyboard")
  const { counts, tooNewToJudge } = useShownPostCounts(spotlight)
  const totalInScope = Object.values(counts).reduce((sum, n) => sum + n, 0)

  // The Post selection (PTR-05): window-wide, so neither a spotlight nor the
  // filter changes these two numbers.
  const selectedCount = Object.values(useScopedPostCounts()).reduce(
    (sum, n) => sum + n,
    0,
  )
  const windowTotal = usePostFacets(true, null)?.total
  // The last Post clicked, where a shift-click's run starts.
  const anchor = useRef<string | null>(null)
  const onToggleSelected = (post: (typeof posts)[number], shift: boolean) => {
    const picks = runPicks(
      posts,
      post,
      !post.selected,
      shift ? anchor.current : null,
    )
    if (appendSelection(picks)) anchor.current = postKey(post)
  }
  // Over what the filter shows, as a rule that reaches the next window too;
  // a ranking cannot be applied again, so its results are picked one by one.
  const selectShown = (select: boolean) => {
    if (ranked) {
      appendSelection(posts.map((post) => pick(select, post)))
      return
    }
    const view = spotlightView(spotlight, {
      channelNames: [...selectedChannels],
      keyword: postSearch,
      filter: postFilter,
      maxPerChannel: maxPostsPerChannel,
      groupByChannel,
    })
    appendSelection([
      rule(
        select,
        snapshotOf({
          filter: view.filter,
          keyword: view.keyword,
          sort: postSortOrder,
          viewMeasure,
          maxPerChannel: view.maxPerChannel,
          maxPerChannelMode: maxPostsPerChannelMode,
          seed: 0,
        }),
      ),
    ])
  }

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

        <PostSelectionBar
          selected={selectedCount}
          total={windowTotal}
          chips={selectionChips(postSelection)}
          ranked={ranked}
          onSelectAll={() => selectShown(true)}
          onDeselectAll={() => selectShown(false)}
          onRemoveChip={removeSelectionChip}
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
          onToggleSelected={onToggleSelected}
        />
        <FeedKeyboard on={keyboard} />
      </motion.div>
    </SpotlightProvider>
  )
}
