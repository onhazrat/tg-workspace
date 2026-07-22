import { motion } from "motion/react"
import type React from "react"
import { useMemo, useState } from "react"
import { SERVER_REPRODUCIBLE_CAP_MODES } from "@/api/data"
import { DiscoverBulkBar } from "@/components/discover/DiscoverBulkBar"
import { DiscoverCandidateTable } from "@/components/discover/DiscoverCandidateTable"
import { DiscoverEmptyState } from "@/components/discover/DiscoverEmptyState"
import { DiscoverFilterBar } from "@/components/discover/DiscoverFilterBar"
import { DiscoverScopeCard } from "@/components/discover/DiscoverScopeCard"
import { DiscoverSortChips } from "@/components/discover/DiscoverSortChips"
import { useDiscoverFollowJob } from "@/components/discover/useDiscoverFollowJob"
import { TgConfirmDialog } from "@/components/ui/tg-confirm-dialog"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { useDiscoverCandidatesQuery } from "@/hooks/useDiscover"
import {
  computeDiscoveryCandidates,
  countUnfollowedCandidates,
  DISCOVERY_SIGNAL_KINDS,
  type DiscoveryEmptyReason,
  type DiscoveryScopeCounts,
  type DiscoverySignalKind,
  deriveDiscoveryEmptyReason,
  filterDiscoveryCandidates,
  sortDiscoveryCandidates,
} from "@/lib/posts/discover-candidates"
import {
  type DiscoveryQuickAction,
  resolveDiscoveryEmptyState,
} from "@/lib/posts/discover-empty-state"
import { useData } from "../contexts/DataContext"
import { useScraper } from "../contexts/ScraperContext"
import { useSettings } from "../contexts/SettingsContext"
import { useUI } from "../contexts/UIContext"
import { useApiStatus } from "../hooks/useApiStatus"

const EMPTY_SCOPE_COUNTS: DiscoveryScopeCounts = {
  forwardPosts: 0,
  mentionPosts: 0,
  linkPosts: 0,
}

export const DiscoverView: React.FC = () => {
  const { channels, selectedChannels } = useData()
  const {
    filteredPosts,
    forwardedFilter,
    setForwardedFilter,
    postSearch,
    semanticSearchQuery,
    followDiscoverChannels,
    setPostSearch,
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
  } = useSettings()

  // Ephemeral: a name filter is a per-visit refinement, not a durable preference.
  const [nameQuery, setNameQuery] = useState("")

  const enabledKinds = useMemo(
    () => new Set<DiscoverySignalKind>(discoverSignals),
    [discoverSignals],
  )

  // The server reproduces Discover for the ordinary case. The client path
  // stays for the two scopes the server cannot reproduce: an active semantic
  // (vector) query, and the per-channel cap's browser-seeded `random` mode.
  const serverEligible =
    !semanticSearchQuery.trim() &&
    (maxPostsPerChannel <= 0 ||
      SERVER_REPRODUCIBLE_CAP_MODES.has(maxPostsPerChannelMode))

  const debouncedPostSearch = useDebouncedValue(postSearch, 300)
  const selectedChannelNames = useMemo(
    () => [...selectedChannels].sort(),
    [selectedChannels],
  )

  const serverParams = useMemo(
    () => ({
      channelNames: selectedChannelNames,
      startDate,
      endDate,
      signals: discoverSignals,
      keyword: debouncedPostSearch,
      forwarded: forwardedFilter,
      media: mediaFilter,
      maxPerChannel: maxPostsPerChannel,
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
    ],
  )

  const serverQueryEnabled =
    serverEligible && selectedChannels.size > 0 && enabledKinds.size > 0
  const serverQuery = useDiscoverCandidatesQuery(
    serverParams,
    serverQueryEnabled,
  )

  const clientResult = useMemo(
    () =>
      serverEligible
        ? null
        : computeDiscoveryCandidates(filteredPosts, channels, {
            forwardedFilter,
            selectedChannelCount: selectedChannels.size,
            enabledKinds,
            semanticQuery: semanticSearchQuery,
          }),
    [
      serverEligible,
      filteredPosts,
      channels,
      forwardedFilter,
      selectedChannels.size,
      enabledKinds,
      semanticSearchQuery,
    ],
  )

  const {
    candidates: rawCandidates,
    scopeCounts,
    emptyReason: computeEmptyReason,
  } = useMemo(() => {
    if (clientResult) return clientResult

    const data = serverQuery.data
    const serverCandidates = data?.candidates ?? []
    // While the first server page is loading, withhold the empty reason so the
    // guide does not flash before candidates arrive.
    const settled =
      !serverQueryEnabled || !serverQuery.isLoading || data != null
    return {
      candidates: serverCandidates,
      scopeCounts: data?.scopeCounts ?? EMPTY_SCOPE_COUNTS,
      emptyReason: settled
        ? deriveDiscoveryEmptyReason({
            enabledKinds,
            selectedChannelCount: selectedChannels.size,
            postsInScope: data?.postsInScope ?? 0,
            candidateCount: serverCandidates.length,
            forwardedFilter,
          })
        : undefined,
    }
  }, [
    clientResult,
    serverQuery.data,
    serverQuery.isLoading,
    serverQueryEnabled,
    enabledKinds,
    selectedChannels.size,
    forwardedFilter,
  ])

  const candidates = useMemo(() => {
    const filtered = filterDiscoveryCandidates(rawCandidates, {
      followState: discoverFollowState,
      minTotal: discoverMinTotal,
      nameQuery,
    })
    return sortDiscoveryCandidates(filtered, discoverSortKey)
  }, [
    rawCandidates,
    discoverFollowState,
    discoverMinTotal,
    nameQuery,
    discoverSortKey,
  ])

  const emptyReason: DiscoveryEmptyReason | undefined =
    computeEmptyReason ??
    (candidates.length === 0 ? "no_matching_candidates" : undefined)
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

  const handleViewPosts = (name: string, isFollowed: boolean) => {
    setForwardedFilter(isFollowed ? "forwarded" : "unfollowed_forwarded")
    setPostSearch(name)
    setActiveTab("posts")
  }

  return (
    <motion.div
      key="discover"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <DiscoverScopeCard
        selectedChannelCount={selectedChannels.size}
        startDate={startDate}
        endDate={endDate}
        forwardedFilter={forwardedFilter}
        postSearch={postSearch}
        scopeCounts={scopeCounts}
        candidateCount={candidates.length}
        unfollowedCount={unfollowedCount}
        semanticSearchQuery={semanticSearchQuery}
        maxPostsPerChannel={maxPostsPerChannel}
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
            <DiscoverSortChips
              sortKey={discoverSortKey}
              onSortKeyChange={setDiscoverSortKey}
            />
          ) : null}
        </div>

        <DiscoverFilterBar
          signals={discoverSignals}
          onToggleSignal={toggleSignal}
          followState={discoverFollowState}
          onFollowStateChange={setDiscoverFollowState}
          minTotal={discoverMinTotal}
          onMinTotalChange={setDiscoverMinTotal}
          nameQuery={nameQuery}
          onNameQueryChange={setNameQuery}
        />

        {candidates.length > 0 && follow.selectedForFollow.size > 0 ? (
          <DiscoverBulkBar
            selectedCount={follow.selectedForFollow.size}
            isOffline={isOffline}
            isFollowJobRunning={follow.isFollowJobRunning}
            followProgress={follow.followProgress}
            onFollowSelected={() => void follow.followSelected()}
            onClearSelection={() => follow.setSelectedForFollow(new Set())}
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

        {candidates.length === 0 && emptyState ? (
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
            onViewPosts={handleViewPosts}
          />
        )}
      </div>

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
