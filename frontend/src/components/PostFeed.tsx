import { useQueryClient } from "@tanstack/react-query"
import { LayoutGrid } from "lucide-react"
import { motion } from "motion/react"
import type React from "react"
import { useCallback, useEffect, useRef } from "react"
import { toast } from "sonner"
import {
  useLiveWindowRefresh,
  usePostFacets,
  usePostsFeed,
  useScopedPostCounts,
  useShownPostCounts,
} from "@/hooks/usePostsView"
import { useCompactPostGrid, useSessionFlag } from "@/hooks/useSessionFlag"
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
import { isRanked } from "@/lib/posts/posts-view"
import {
  limitNote,
  postLinks,
  postsMarkdown,
} from "@/lib/posts/selected-export"
import { cn } from "@/lib/utils"
import { useData } from "../contexts/DataContext"
import {
  invalidatePostsReads,
  usePostsViewEdits,
  usePostsViewState,
} from "../contexts/PostsViewContext"
import { useUI } from "../contexts/UIContext"
import { LiveWindowBanner } from "./complete-window/LiveWindowBanner"
import { PostCard } from "./PostCard"
import { PostFeedResults } from "./PostFeedResults"
import { PostFilter } from "./PostFilter"
import { pillClass } from "./PostFilterParts"
import { PostSelectionBar } from "./PostSelectionBar"
import {
  SpotlightBanner,
  SpotlightProvider,
  useSpotlightBack,
  useSpotlightState,
} from "./post-card/ChannelSpotlight"
import { postCardKey, usePostKeys } from "./post-card/FeedKeyboard"
import { NewPostsPill, useHeldPosts } from "./post-card/NewPosts"
import { FeedPagingContext } from "./post-card/PhotoViewer"
import { ReplyChainPanel, useReplyChain } from "./post-card/ReplyChain"
import { ReplyPreviewProvider } from "./post-card/ReplyParent"
import {
  chainKeys,
  newestKey,
  PanelChainView,
  panelCard,
  panelItem,
  parentKey,
  revealInPanel,
  useChainMark,
  usePanelChain,
} from "./posts-chain-prototype/PanelChain"
import {
  ChainOpenContext,
  PrototypeSwitcher,
  useVariant,
  VARIANT_ROWS,
} from "./posts-chain-prototype/variant"

interface PostFeedProps {
  loadMoreRef: React.RefObject<HTMLDivElement | null>
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

export const PostFeed: React.FC<PostFeedProps> = ({
  loadMoreRef,
  scrollContainerRef,
}) => {
  const { view } = usePostsViewState()
  const { appendSelection, removeSelectionChip } = usePostsViewEdits()
  const { channels } = useData()
  const ranked = isRanked(view)
  const spotlightApi = useSpotlightState(
    scrollContainerRef,
    view.filter,
    ranked,
  )
  const { spotlight } = spotlightApi
  const [compact, setCompact] = useCompactPostGrid()
  const { counts, tooNewToJudge, selectedShown } = useShownPostCounts(spotlight)
  const [selectedFirst, setSelectedFirst] = useSessionFlag(
    "postFeed_selectedFirst",
  )
  const {
    posts: loaded,
    feedKey,
    isInitialLoading,
    hasMore,
    loadMore,
    isLoadingMore,
    fetchSelectedShown,
  } = usePostsFeed(spotlight, {
    selectedFirst,
    selectedShownTotal: selectedShown,
  })
  // PROTOTYPE (posts-reply-chain): variant 0 is main, without any of this.
  const variant = useVariant()
  const proto = variant !== "0"
  // What a refetch brings in above the reader waits behind the pill.
  const { shown, held, showHeld } = useHeldPosts(loaded, feedKey)
  const posts = proto ? shown : loaded
  const feedChain = useReplyChain(posts)
  const panelChain = usePanelChain(posts)
  const chain = variant === "A2" ? panelChain : feedChain
  // A3: [ opens the whole chain, ] closes it, and the regular keys move in it.
  const a3 = variant === "A3"
  const a3Items =
    a3 && panelChain.chain ? chainKeys(panelChain.chain) : undefined
  const openChain = a3 ? panelChain.openWhole : chain.open

  const { setActiveTab } = useUI()
  const backFromSpotlight = useSpotlightBack(spotlightApi, () =>
    setActiveTab("channels"),
  )
  const highlight = usePostKeys({
    keys: posts.map(postCardKey),
    onCompact: setCompact,
    spotlit: spotlight !== null,
    onSpotlightBack: backFromSpotlight,
    chain: a3
      ? { key: panelChain.keyWhole, clear: panelChain.clear }
      : proto
        ? chain
        : undefined,
    onShowNew: proto ? showHeld : undefined,
    target: variant === "A2" ? panelCard : undefined,
    panel: a3Items && {
      items: a3Items,
      element: panelItem,
      reveal: revealInPanel,
    },
    extraRows: VARIANT_ROWS[variant],
  })
  useChainMark(
    posts,
    variant === "A2" && panelChain.chain
      ? newestKey(panelChain.chain)
      : a3Items
        ? highlight
        : null,
  )
  // A2: while the panel is open the Highlight is in it, and the feed's copy
  // of that Post carries the dashed outline instead.
  const feedHighlight =
    (variant === "A2" || a3) && panelChain.chain ? null : highlight

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
    const shown = spotlightView(spotlight, view)
    return snapshotOf({ ...shown, seed: 0 })
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
  const queryClient = useQueryClient()
  useLiveWindowRefresh(
    useCallback(() => invalidatePostsReads(queryClient), [queryClient]),
  )

  // A spotlight drops the cap and grouping, so the subtitle names neither.
  const subtitle = spotlight
    ? ""
    : feedSubtitle(
        view.maxPerChannel,
        view.maxPerChannelMode,
        view.sort,
        view.groupByChannel,
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
      {/* The photo viewer pages the feed while it is open (PTI-05). */}
      <FeedPagingContext.Provider value={{ loadMore, hasMore }}>
        <motion.div
          key="posts"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6 pb-10"
        >
          <PostFilter
            shownCount={totalInScope}
            subtitle={subtitle}
            tooNewToJudge={tooNewToJudge}
            trailing={
              <button
                type="button"
                aria-pressed={compact}
                onClick={() => setCompact(!compact)}
                className={cn(pillClass(compact), "ml-auto")}
              >
                <LayoutGrid size={12} /> Compact grid
              </button>
            }
          />

          <LiveWindowBanner where="posts" />
          <PostSelectionBar
            selected={selectedCount}
            total={windowTotal}
            chips={selectionChips(view.selection)}
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

          {/* Its own block, so the pill's sticky row takes no room in the feed. */}
          <div>
            <div className="sticky top-2 z-30 flex h-0 justify-center">
              {proto && <NewPostsPill held={held} onShow={showHeld} />}
            </div>
            <ChainOpenContext value={proto ? { open: openChain } : null}>
              <ReplyPreviewProvider>
                <PostFeedResults
                  isInitialLoading={isInitialLoading}
                  posts={posts}
                  showLoadMore={hasMore || isLoadingMore}
                  loadMoreRef={loadMoreRef}
                  postSearch={view.keyword}
                  compact={compact}
                  highlight={feedHighlight}
                  onToggleSelected={onToggleSelected}
                  mainSkeleton={!proto}
                />
              </ReplyPreviewProvider>
            </ChainOpenContext>
          </div>
          {variant === "A" && (
            <ReplyChainPanel
              steps={feedChain.steps}
              onClose={feedChain.clear}
              onBack={feedChain.back}
            />
          )}
          {(variant === "A2" || a3) && (
            <ChainOpenContext value={{ open: openChain }}>
              <ReplyPreviewProvider>
                <PanelChainView
                  chain={panelChain.chain}
                  onBack={a3 ? undefined : panelChain.back}
                  onClose={panelChain.clear}
                  dimOthers={!a3 || highlight !== null}
                  // With no keyboard (a phone), the ring stays on the Post the
                  // reply answers.
                  highlight={
                    a3
                      ? (highlight ??
                        (panelChain.chain &&
                          parentKey(panelChain.chain.origin)))
                      : undefined
                  }
                  renderPost={(post) => (
                    <PostCard
                      post={post}
                      postSearch=""
                      onToggleSelected={onToggleSelected}
                    />
                  )}
                />
              </ReplyPreviewProvider>
            </ChainOpenContext>
          )}
          <PrototypeSwitcher />
        </motion.div>
      </FeedPagingContext.Provider>
    </SpotlightProvider>
  )
}
