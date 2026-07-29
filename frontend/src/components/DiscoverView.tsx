import { Sparkles } from "lucide-react"
import { motion } from "motion/react"
import type React from "react"
import { useMemo, useState } from "react"
import { DiscoverBulkBar } from "@/components/discover/DiscoverBulkBar"
import { DiscoverCandidatePanel } from "@/components/discover/DiscoverCandidatePanel"
import { DiscoverCandidateTable } from "@/components/discover/DiscoverCandidateTable"
import { DiscoverEmptyState } from "@/components/discover/DiscoverEmptyState"
import { DiscoverFilterBar } from "@/components/discover/DiscoverFilterBar"
import { DiscoverProbeBar } from "@/components/discover/DiscoverProbeBar"
import { DiscoverReportBar } from "@/components/discover/DiscoverReportBar"
import { DiscoverScopeCard } from "@/components/discover/DiscoverScopeCard"
import { DiscoverSortChips } from "@/components/discover/DiscoverSortChips"
import { DiscoverWeightsEditor } from "@/components/discover/DiscoverWeightsEditor"
import { useDiscoverFollowJob } from "@/components/discover/useDiscoverFollowJob"
import { useDiscoverProbeSweep } from "@/components/discover/useDiscoverProbeSweep"
import { TgButton } from "@/components/ui/tg-button"
import { TgConfirmDialog } from "@/components/ui/tg-confirm-dialog"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import {
  type DiscoverCandidatesParams,
  useCreateDiscoverReportMutation,
  useDiscoverIgnoreMutation,
  useDiscoverReportQuery,
  useLatestDiscoverReportQuery,
} from "@/hooks/useDiscover"
import { useDiscoverReportParam } from "@/hooks/useDiscoverReportParam"
import {
  countUnfollowedCandidates,
  DISCOVERY_SIGNAL_KINDS,
  type DiscoveryCandidate,
  type DiscoveryEmptyReason,
  type DiscoverySignalKind,
  deriveDiscoveryEmptyReason,
  filterDiscoveryCandidates,
  sortDiscoveryCandidates,
} from "@/lib/posts/discover-candidates"
import {
  type DiscoveryQuickAction,
  resolveDiscoveryEmptyState,
} from "@/lib/posts/discover-empty-state"
import {
  type DiscoverReportView,
  reportSignalKinds,
  savedReportToView,
} from "@/lib/posts/discover-report-view"
import { removeFromSelection } from "@/lib/posts/discover-selection"
import { useData } from "../contexts/DataContext"
import { useScraper } from "../contexts/ScraperContext"
import { useSettings } from "../contexts/SettingsContext"
import { useUI } from "../contexts/UIContext"
import { useApiStatus } from "../hooks/useApiStatus"

/**
 * Seed for the `random` per-channel cap.
 *
 * Must match the Posts feed's seed (`usePostsView`, `ScraperContext`), which is
 * likewise a constant 0 — a different seed would make Discover aggregate over a
 * different "random" sample than the Posts tab shows for the same settings.
 */
const RANDOM_CAP_SEED = 0

/**
 * Discover: which channels do the channels you follow keep pointing at?
 *
 * A generated report is *saved* (IDEA-011 W1). The Channels/Posts selections
 * are its input, captured at generate time; afterwards the report is immutable
 * and nothing the user does elsewhere recomputes or invalidates it. That is why
 * this component has no scope-invalidation effect: there is no derived result
 * to keep in sync, only a stored artifact to display.
 */
export const DiscoverView: React.FC = () => {
  const { selectedChannels } = useData()
  const {
    getScopedPosts,
    forwardedFilter,
    setForwardedFilter,
    postSearch,
    semanticSearchQuery,
    followDiscoverChannels,
    maxPostsPerChannel,
    maxPostsPerChannelMode,
    mediaFilter,
  } = useScraper()
  const { setActiveTab, startDate, endDate } = useUI()
  const { isOffline } = useApiStatus()
  const {
    discoverSignals,
    setDiscoverSignals,
    discoverSortKey,
    setDiscoverSortKey,
    discoverFollowState,
    setDiscoverFollowState,
    discoverMinTotal,
    setDiscoverMinTotal,
    discoverSignalWeights,
    setDiscoverSignalWeights,
  } = useSettings()

  // Ephemeral: a name filter is a per-visit refinement, not a durable preference.
  const [nameQuery, setNameQuery] = useState("")
  const [inspecting, setInspecting] = useState<DiscoveryCandidate | null>(null)

  const { reportId, openReport } = useDiscoverReportParam()

  const debouncedPostSearch = useDebouncedValue(postSearch, 300)
  const selectedChannelNames = useMemo(
    () => [...selectedChannels].sort(),
    [selectedChannels],
  )

  /** Live scope — the *input* to the next report, never a description of one. */
  const liveParams: DiscoverCandidatesParams = useMemo(
    () => ({
      channelNames: selectedChannelNames,
      startDate,
      endDate,
      signals: discoverSignals,
      keyword: debouncedPostSearch,
      forwarded: forwardedFilter,
      media: mediaFilter,
      maxPerChannel: maxPostsPerChannel,
      maxPerChannelMode: maxPostsPerChannelMode,
      seed: RANDOM_CAP_SEED,
    }),
    [
      selectedChannelNames,
      startDate,
      endDate,
      discoverSignals,
      debouncedPostSearch,
      forwardedFilter,
      mediaFilter,
      maxPostsPerChannel,
      maxPostsPerChannelMode,
    ],
  )

  const latestQuery = useLatestDiscoverReportQuery(reportId === null)
  const pinnedQuery = useDiscoverReportQuery(reportId)
  const createReport = useCreateDiscoverReportMutation()
  const setIgnored = useDiscoverIgnoreMutation()

  const view: DiscoverReportView | null = useMemo(() => {
    const saved = reportId !== null ? pinnedQuery.data : latestQuery.data
    return saved ? savedReportToView(saved) : null
  }, [reportId, pinnedQuery.data, latestQuery.data])

  const isLoadingReport =
    reportId !== null ? pinnedQuery.isLoading : latestQuery.isLoading

  /**
   * Generate and save a report.
   *
   * A semantic query is the one scope whose *post selection* the server cannot
   * derive from the scope alone — the vector search owns that ranking. So the
   * client resolves which posts matched and passes their ids; the aggregation
   * still happens server-side, in the single implementation (IDEA-011 D14).
   */
  const handleGenerate = async () => {
    const params = { ...liveParams }
    if (semanticSearchQuery.trim()) {
      const posts = await getScopedPosts()
      params.postIds = posts.map((post) => ({
        channelName: post.channelName,
        postId: post.id,
      }))
    }
    const report = await createReport.mutateAsync(params)
    // Pin the new report so it stays on screen even as newer ones appear.
    openReport(report.id)
  }

  const showLatest = () => {
    openReport(null)
  }

  const rawCandidates = useMemo(() => view?.candidates ?? [], [view])

  // Filtering and ranking are client-side over the saved report, so changing a
  // weight or a threshold re-ranks instantly instead of regenerating.
  const candidates = useMemo(() => {
    const filtered = filterDiscoveryCandidates(rawCandidates, {
      followState: discoverFollowState,
      minTotal: discoverMinTotal,
      nameQuery,
    })
    return sortDiscoveryCandidates(
      filtered,
      discoverSortKey,
      discoverSignalWeights,
    )
  }, [
    rawCandidates,
    discoverFollowState,
    discoverMinTotal,
    nameQuery,
    discoverSortKey,
    discoverSignalWeights,
  ])

  /**
   * Why the report is empty, described in terms of the report's own scope.
   *
   * Uses the signals the report was generated with rather than the chips'
   * current value — the chips configure the *next* run, so after changing them
   * they no longer explain what is on screen.
   */
  const emptyReason: DiscoveryEmptyReason | undefined = useMemo(() => {
    if (!view) return undefined
    const computed = deriveDiscoveryEmptyReason({
      enabledKinds: reportSignalKinds(view, DISCOVERY_SIGNAL_KINDS),
      selectedChannelCount: view.scope.channels.length,
      postsInScope: view.postsInScope,
      candidateCount: rawCandidates.length,
      forwardedFilter: view.scope.forwarded,
    })
    if (computed) return computed
    return candidates.length === 0 ? "no_matching_candidates" : undefined
  }, [view, rawCandidates.length, candidates.length])

  const emptyState = resolveDiscoveryEmptyState(emptyReason)

  const unfollowedCount = useMemo(
    () => countUnfollowedCandidates(candidates),
    [candidates],
  )

  const follow = useDiscoverFollowJob({
    candidates,
    isOffline,
    followDiscoverChannels,
  })

  /**
   * Resolve what each candidate handle actually is, in the background (D9).
   *
   * Fed `rawCandidates` rather than the filtered `candidates`: the sweep should
   * cover the whole report, not just the slice currently on screen, or changing
   * a filter would silently change which handles ever get checked.
   *
   * `compute_discover_candidates` stores them strongest-first, so this is
   * already the rank order the sweep probes in — the top of the report resolves
   * within seconds rather than after the single-reference tail.
   */
  const probe = useDiscoverProbeSweep({
    candidates: rawCandidates,
    enabled: !isOffline && view !== null,
  })

  /**
   * Dismiss (or restore) every selected candidate in one call.
   *
   * Scoped to the same selection bulk-follow uses, which excludes followed
   * candidates — their row checkbox is disabled. Those are still dismissable
   * one at a time from the row's own button.
   */
  const dismissSelected = () => {
    const names = [...follow.selectedForFollow]
    if (names.length === 0) return
    const ignored = discoverFollowState !== "ignored"
    setIgnored.mutate(
      { handles: names, ignored },
      {
        onSuccess: () => {
          follow.setSelectedForFollow((prev) =>
            removeFromSelection(prev, names),
          )
        },
      },
    )
  }

  /**
   * Re-probe every selected candidate.
   *
   * The selection clears afterwards because a successful recheck moves rows out
   * of the "Not followable" view, and a count referring to rows no longer on
   * screen is worse than no count.
   */
  const recheckSelected = () => {
    const names = [...follow.selectedForFollow]
    if (names.length === 0) return
    probe.recheck(names)
    follow.setSelectedForFollow(new Set())
  }

  const toggleSignal = (kind: DiscoverySignalKind) => {
    setDiscoverSignals(
      discoverSignals.includes(kind)
        ? discoverSignals.filter((entry) => entry !== kind)
        : [...discoverSignals, kind],
    )
  }

  const resetCandidateFilters = () => {
    setDiscoverFollowState("all")
    setDiscoverMinTotal(1)
    setNameQuery("")
  }

  const runQuickAction = (action: DiscoveryQuickAction) => {
    if (action.type === "set_forwarded_filter") {
      setForwardedFilter(action.value)
      return
    }
    if (action.type === "enable_all_signals") {
      setDiscoverSignals([...DISCOVERY_SIGNAL_KINDS])
      return
    }
    if (action.type === "reset_candidate_filters") {
      resetCandidateFilters()
      return
    }
    setActiveTab(action.tab)
  }

  return (
    <motion.div
      key="discover"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <DiscoverReportBar
        view={view}
        isPinned={reportId !== null}
        isGenerating={createReport.isPending}
        isOffline={isOffline}
        onGenerate={() => void handleGenerate()}
        onShowLatest={showLatest}
      />

      <DiscoverScopeCard
        view={view}
        liveChannelCount={selectedChannels.size}
        candidateCount={candidates.length}
        unfollowedCount={unfollowedCount}
      />

      <div className="rounded-xl border border-app-ink/10 bg-app-card p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-bold uppercase tracking-widest text-app-ink/70">
            Channel Candidates
            {candidates.length > 0 ? (
              <span className="ml-2 font-normal normal-case tracking-normal text-app-ink/60">
                ({candidates.length} candidate
                {candidates.length === 1 ? "" : "s"})
              </span>
            ) : null}
          </h3>
          {candidates.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {discoverSortKey === "weighted" ? (
                <DiscoverWeightsEditor
                  weights={discoverSignalWeights}
                  onChange={setDiscoverSignalWeights}
                />
              ) : null}
              <DiscoverSortChips
                sortKey={discoverSortKey}
                onSortKeyChange={setDiscoverSortKey}
              />
            </div>
          ) : null}
        </div>

        {/*
         * Only the *result* filters are gated. Signals configures the next run —
         * it feeds the request rather than filtering what is on screen — so it
         * stays visible even with no report. See `showResultFilters`.
         */}
        <DiscoverFilterBar
          signals={discoverSignals}
          onToggleSignal={toggleSignal}
          followState={discoverFollowState}
          onFollowStateChange={setDiscoverFollowState}
          minTotal={discoverMinTotal}
          onMinTotalChange={setDiscoverMinTotal}
          nameQuery={nameQuery}
          onNameQueryChange={setNameQuery}
          showResultFilters={view !== null}
        />

        {probe.isRunning && probe.job ? (
          <DiscoverProbeBar
            job={probe.job}
            onCancel={() => void probe.cancel()}
          />
        ) : null}

        {candidates.length > 0 && follow.selectedForFollow.size > 0 ? (
          <DiscoverBulkBar
            selectedCount={follow.selectedForFollow.size}
            isOffline={isOffline}
            isFollowJobRunning={follow.isFollowJobRunning}
            followProgress={follow.followProgress}
            onFollowSelected={() => void follow.followSelected()}
            onClearSelection={() => follow.setSelectedForFollow(new Set())}
            onDismissSelected={dismissSelected}
            dismissMode={
              discoverFollowState === "ignored" ? "restore" : "dismiss"
            }
            isDismissPending={setIgnored.isPending}
            onRecheckSelected={recheckSelected}
            showRecheck={discoverFollowState === "unavailable"}
            isRecheckPending={probe.isRecheckPending}
          />
        ) : null}

        {follow.isFollowJobRunning &&
        follow.followProgress &&
        follow.selectedForFollow.size === 0 ? (
          <div
            className="mb-3 text-xs text-app-ink/60"
            data-testid="discover-follow-progress"
          >
            Following… {follow.followProgress.completed}/
            {follow.followProgress.total}
          </div>
        ) : null}

        {isLoadingReport ? (
          <p className="py-12 text-center text-sm text-app-ink/50">
            Loading report…
          </p>
        ) : view === null ? (
          <div
            className="flex flex-col items-center gap-4 py-12 text-center"
            data-testid="discover-generate-prompt"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-app-muted border border-app-ink/10">
              <Sparkles size={22} className="opacity-60" />
            </div>
            <div className="max-w-md">
              <p className="text-sm font-semibold">Discover new channels</p>
              <p className="mt-1 text-xs text-app-ink/60">
                Generate a report of channels your selection forwards from,
                mentions, or links to over the current time range. Reports are
                saved, so changing your selection later won't affect them.
              </p>
            </div>
            <TgButton
              variant="primary"
              onClick={() => void handleGenerate()}
              disabled={isOffline || createReport.isPending}
              loading={createReport.isPending}
              loadingLabel="Generating…"
              data-testid="discover-generate-empty-button"
            >
              <Sparkles size={15} />
              Generate Discovery Report
            </TgButton>
          </div>
        ) : candidates.length === 0 && emptyState ? (
          <DiscoverEmptyState
            state={emptyState}
            onQuickAction={runQuickAction}
          />
        ) : (
          <DiscoverCandidateTable
            candidates={candidates}
            selectedForFollow={follow.selectedForFollow}
            setSelectedForFollow={follow.setSelectedForFollow}
            unfollowedCount={unfollowedCount}
            isOffline={isOffline}
            isFollowJobRunning={follow.isFollowJobRunning}
            activeFollowNames={follow.activeFollowNames}
            resultStatusByName={follow.resultStatusByName}
            onFollow={(name) => void follow.followOne(name)}
            onInspect={setInspecting}
            onSetIgnored={(name, ignored) =>
              setIgnored.mutate({ handles: [name], ignored })
            }
            onRecheck={(name) => probe.recheck([name])}
            isRecheckPending={probe.isRecheckPending}
            weights={discoverSignalWeights}
            showScore={discoverSortKey === "weighted"}
          />
        )}
      </div>

      <DiscoverCandidatePanel
        candidate={inspecting}
        onClose={() => setInspecting(null)}
        isOffline={isOffline}
        isFollowJobRunning={follow.isFollowJobRunning}
        onFollow={(name) => void follow.followOne(name)}
      />

      <TgConfirmDialog
        open={follow.pendingFollowNames !== null}
        onOpenChange={(open) => {
          if (!open) follow.setPendingFollowNames(null)
        }}
        title="Follow channels?"
        description={
          follow.pendingFollowNames
            ? `Follow ${follow.pendingFollowNames.length} channels? This will scrape and add each selected source.`
            : ""
        }
        confirmLabel="Follow"
        onConfirm={() => {
          const names = follow.pendingFollowNames ?? []
          follow.setPendingFollowNames(null)
          void follow.executeFollow(names)
        }}
        onCancel={() => follow.setPendingFollowNames(null)}
      />
    </motion.div>
  )
}
