import { Keyboard, LayoutGrid } from "lucide-react"
import { motion } from "motion/react"
import type React from "react"
import { useEffect, useRef } from "react"
import { toast } from "sonner"
import {
  isSemanticFeed,
  useLiveWindowRefresh,
  usePostFacets,
  usePostsFeed,
  useScopedPostCounts,
  useShownPostCounts,
} from "@/hooks/usePostsView"
import { downloadBlob } from "@/lib/data-transfer/download"
import { spotlightView } from "@/lib/posts/channel-spotlight"
import { feedSubtitle } from "@/lib/posts/post-filter-bar"
import {
  pick,
  postKey,
  regionCounts,
  regionSteps,
  rule,
  runPicks,
  selectionChips,
  snapshotOf,
} from "@/lib/posts/post-selection"
import {
  limitNote,
  postLinks,
  postsMarkdown,
} from "@/lib/posts/selected-export"
import { cn } from "@/lib/utils"
import { useData } from "../contexts/DataContext"
import { useScraper } from "../contexts/ScraperContext"
import { useSettings } from "../contexts/SettingsContext"
import { useSessionFlag } from "../hooks/useSessionFlag"
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
  const [compact, setCompact] = useSessionFlag("postFeed_compactGrid")
  const [keyboard, setKeyboard] = useSessionFlag("postFeed_keyboard")
  const { counts, tooNewToJudge, selectedShown } = useShownPostCounts(spotlight)
  const [selectedFirst, setSelectedFirst] = useSessionFlag(
    "postFeed_selectedFirst",
  )
  const {
    posts,
    isInitialLoading,
    hasMore,
    loadMore,
    isLoadingMore,
    fetchSelectedShown,
  } = usePostsFeed(spotlight, {
    selectedFirst,
    selectedShownTotal: selectedShown,
  })

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
  // What the filter shows, as a rule records it; in a spotlight that is the
  // spotlight's filter, so it means that Channel.
  const shownSnapshot = () => {
    const view = spotlightView(spotlight, {
      channelNames: [...selectedChannels],
      keyword: postSearch,
      filter: postFilter,
      maxPerChannel: maxPostsPerChannel,
      groupByChannel,
    })
    return snapshotOf({
      filter: view.filter,
      keyword: view.keyword,
      sort: postSortOrder,
      viewMeasure,
      maxPerChannel: view.maxPerChannel,
      maxPerChannelMode: maxPostsPerChannelMode,
      seed: 0,
    })
  }
  // Over what the filter shows, as a rule that reaches the next window too;
  // a ranking cannot be applied again, so its results are picked one by one.
  const selectShown = (select: boolean) =>
    appendSelection(
      ranked
        ? posts.map((post) => pick(select, post))
        : [rule(select, shownSnapshot())],
    )

  // Copy links and Export Markdown (PTR-06): the selected Posts the filter
  // shows, read from the feed.
  const withSelectedShown = async (
    use: (shown: typeof posts, note: string) => Promise<void> | void,
  ) => {
    try {
      const { posts: shown, total } = await fetchSelectedShown()
      if (shown.length === 0) {
        toast.info("No selected Posts are shown")
        return
      }
      await use(shown, limitNote(shown.length, total))
    } catch {
      toast.error("Could not read the selected Posts")
    }
  }
  const copyLinks = () =>
    withSelectedShown(async (shown, note) => {
      await navigator.clipboard.writeText(postLinks(shown))
      toast.success(`Copied ${shown.length.toLocaleString()} links.${note}`)
    })
  const exportMarkdown = () =>
    withSelectedShown((shown, note) => {
      downloadBlob(
        new Blob([postsMarkdown(shown)], { type: "text/markdown" }),
        `selected-posts-${new Date().toISOString().slice(0, 10)}.md`,
      )
      if (note) toast.info(note.trim())
    })

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
          regions={
            ranked
              ? undefined
              : regionCounts({
                  selected: selectedCount,
                  selectedShown,
                  shown: totalInScope,
                })
          }
          onAdjust={(keep) =>
            appendSelection(regionSteps(keep, shownSnapshot()))
          }
          selectedFirst={selectedFirst}
          onSelectedFirstChange={setSelectedFirst}
          onCopyLinks={copyLinks}
          onExportMarkdown={exportMarkdown}
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
