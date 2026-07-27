import { Sparkles } from "lucide-react"
import { motion } from "motion/react"
import type React from "react"
import { useEffect, useMemo, useState } from "react"
import { SERVER_REPRODUCIBLE_CAP_MODES } from "@/api/data"
import { DiscoverBulkBar } from "@/components/discover/DiscoverBulkBar"
import { DiscoverCandidateTable } from "@/components/discover/DiscoverCandidateTable"
import { DiscoverEmptyState } from "@/components/discover/DiscoverEmptyState"
import { DiscoverFilterBar } from "@/components/discover/DiscoverFilterBar"
import { DiscoverScopeCard } from "@/components/discover/DiscoverScopeCard"
import { DiscoverSortChips } from "@/components/discover/DiscoverSortChips"
import { useDiscoverFollowJob } from "@/components/discover/useDiscoverFollowJob"
import { TgButton } from "@/components/ui/tg-button"
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
import type { Post } from "../types"

const EMPTY_SCOPE_COUNTS: DiscoveryScopeCounts = {
  forwardPosts: 0,
  mentionPosts: 0,
  linkPosts: 0,
}

export const DiscoverView: React.FC = () => {
  const { channels, selectedChannels } = useData()
  const {
    getScopedPosts,
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

  // Discover is an action tab: nothing is computed until the user asks for a
  // report, and changing the scope returns to the "Generate" prompt. This keeps
  // opening the tab (or changing channels) from doing any work.
  const [generated, setGenerated] = useState(false)
  // Posts for the client fallback (semantic / random cap), fetched on generate.
  const [clientPosts, setClientPosts] = useState<Post[]>([])

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

  // Return to the "Generate" prompt whenever the scope that defines a report
  // changes, so a shown report is never silently stale for a different scope.
  const scopeSignature = useMemo(
    () =>
      JSON.stringify(serverParams) +
      semanticSearchQuery +
      maxPostsPerChannelMode,
    [serverParams, semanticSearchQuery, maxPostsPerChannelMode],
  )
  useEffect(() => {
    setGenerated(false)
    setClientPosts([])
  }, [scopeSignature])

  const handleGenerate = async () => {
    setGenerated(true)
    if (!serverEligible) {
      setClientPosts(await getScopedPosts())
    }
  }

  const serverQueryEnabled =
    generated &&
    serverEligible &&
    selectedChannels.size > 0 &&
    enabledKinds.size > 0
  const serverQuery = useDiscoverCandidatesQuery(
    serverParams,
    serverQueryEnabled,
  )

  const clientResult = useMemo(
    () =>
      serverEligible || !generated
        ? null
        : computeDiscoveryCandidates(clientPosts, channels, {
            forwardedFilter,
            selectedChannelCount: selectedChannels.size,
            enabledKinds,
            semanticQuery: semanticSearchQuery,
          }),
    [
      serverEligible,
      generated,
      clientPosts,
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

        {/*
         * Only the *result* filters are gated. Signals configures the run — it
         * feeds the request and changing it invalidates a generated report — so
         * it stays on screen; gating the whole bar hid the one control you need
         * before generating. See `DiscoverFilterBar`'s `showResultFilters`.
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
          showResultFilters={generated}
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

        {!generated ? (
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
                mentions, or links to over the current time range.
              </p>
            </div>
            <TgButton
              variant="primary"
              onClick={() => void handleGenerate()}
              disabled={isOffline}
              data-testid="discover-generate-button"
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
