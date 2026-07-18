import { Compass, Plus } from "lucide-react"
import { motion } from "motion/react"
import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import type { FollowJobStatus } from "@/api"
import { TgButton } from "@/components/ui/tg-button"
import { TgFilterChip } from "@/components/ui/tg-chips"
import { TgConfirmDialog } from "@/components/ui/tg-confirm-dialog"
import {
  type DiscoveryQuickAction,
  FORWARDED_FILTER_LABELS,
  resolveDiscoveryEmptyState,
} from "@/lib/posts/discover-empty-state"
import {
  computeForwardSourceDiscovery,
  countForwardPosts,
  countUnfollowedSources,
  DISCOVER_SORT_OPTIONS,
  type DiscoverSortKey,
  sortForwardSourceCandidates,
} from "@/lib/posts/discover-forward-sources"
import {
  buildBulkFollowChannels,
  headerCheckboxState,
  isRowCheckboxChecked,
  isRowCheckboxDisabled,
  needsBulkFollowConfirm,
  pruneSelectionAfterFollow,
  toggleSelectAllUnfollowed,
  toggleUnfollowedSelection,
} from "@/lib/posts/discover-selection"
import { telegramWebViewChannelUrl } from "@/lib/telegram-web"
import { formatDateToLocalISO } from "@/lib/utils"
import { useData } from "../contexts/DataContext"
import { useScraper } from "../contexts/ScraperContext"
import { useUI } from "../contexts/UIContext"
import { useApiStatus } from "../hooks/useApiStatus"
import { RelativeTime } from "./RelativeTime"

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
  } = useScraper()
  const { setActiveTab, startDate, endDate } = useUI()
  const { isOffline } = useApiStatus()
  const [sortKey, setSortKey] = useState<DiscoverSortKey>("postCount")
  const [selectedForFollow, setSelectedForFollow] = useState<Set<string>>(
    () => new Set(),
  )
  const [isFollowJobRunning, setIsFollowJobRunning] = useState(false)
  const [followProgress, setFollowProgress] = useState<FollowJobStatus | null>(
    null,
  )
  const [pendingFollowNames, setPendingFollowNames] = useState<string[] | null>(
    null,
  )
  const [activeFollowNames, setActiveFollowNames] = useState<string[]>([])
  const headerCheckboxRef = useRef<HTMLInputElement>(null)

  const { candidates: rawCandidates, emptyReason } = useMemo(
    () =>
      computeForwardSourceDiscovery(filteredPosts, channels, {
        forwardedFilter,
        selectedChannelCount: selectedChannels.size,
        semanticQuery: semanticSearchQuery,
      }),
    [
      filteredPosts,
      channels,
      forwardedFilter,
      selectedChannels.size,
      semanticSearchQuery,
    ],
  )

  const candidates = useMemo(
    () => sortForwardSourceCandidates(rawCandidates, sortKey),
    [rawCandidates, sortKey],
  )

  const candidatesByName = useMemo(() => {
    const map = new Map(
      candidates.map((row) => [row.name, { samplePost: row.samplePost }]),
    )
    return map
  }, [candidates])

  const emptyState = resolveDiscoveryEmptyState(emptyReason)
  const forwardPostCount = useMemo(
    () => countForwardPosts(filteredPosts),
    [filteredPosts],
  )
  const unfollowedSourceCount = useMemo(
    () => countUnfollowedSources(candidates),
    [candidates],
  )

  const headerState = useMemo(
    () => headerCheckboxState(candidates, selectedForFollow),
    [candidates, selectedForFollow],
  )

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = headerState === "indeterminate"
    }
  }, [headerState])

  const resultStatusByName = useMemo(() => {
    const map = new Map<string, string>()
    for (const result of followProgress?.results ?? []) {
      map.set(result.name, result.status)
    }
    return map
  }, [followProgress])

  const runQuickAction = (action: DiscoveryQuickAction) => {
    if (action.type === "set_forwarded_filter") {
      setForwardedFilter(action.value)
      return
    }
    setActiveTab(action.tab)
  }

  const handleViewPosts = (name: string, isFollowed: boolean) => {
    setForwardedFilter(isFollowed ? "forwarded" : "unfollowed_forwarded")
    setPostSearch(name)
    setActiveTab("posts")
  }

  const executeFollow = async (names: string[]) => {
    if (names.length === 0 || isOffline || isFollowJobRunning) return

    const payload = buildBulkFollowChannels(names, candidatesByName)
    setIsFollowJobRunning(true)
    setActiveFollowNames(names)
    setFollowProgress(null)
    try {
      const status = await followDiscoverChannels(payload, {
        onProgress: setFollowProgress,
      })
      if (status) {
        setSelectedForFollow((prev) =>
          pruneSelectionAfterFollow(prev, status.results),
        )
        setFollowProgress(status)
      }
    } finally {
      setIsFollowJobRunning(false)
      setActiveFollowNames([])
    }
  }

  const startFollow = async (names: string[]) => {
    if (names.length === 0 || isOffline || isFollowJobRunning) return
    if (needsBulkFollowConfirm(names.length)) {
      setPendingFollowNames(names)
      return
    }
    await executeFollow(names)
  }

  const handleFollow = async (name: string) => {
    const candidate = candidates.find((row) => row.name === name)
    if (!candidate || candidate.isFollowed) return
    await startFollow([name])
  }

  const handleFollowSelected = async () => {
    const names = [...selectedForFollow].filter((name) => {
      const row = candidates.find((c) => c.name === name)
      return row && !row.isFollowed
    })
    await startFollow(names)
  }

  return (
    <motion.div
      key="discover"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <section className="rounded-xl border border-app-ink/10 bg-app-card p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Compass size={16} className="text-app-ink/60" />
          <h2 className="text-sm font-bold uppercase tracking-widest text-app-ink/70">
            Discovery Scope
          </h2>
        </div>
        <div className="grid gap-2 text-sm text-app-ink/80 sm:grid-cols-2">
          <p>
            <span className="text-app-ink/50">Channels:</span>{" "}
            {selectedChannels.size} selected
          </p>
          <p>
            <span className="text-app-ink/50">Date range:</span>{" "}
            {formatDateToLocalISO(new Date(startDate))} –{" "}
            {formatDateToLocalISO(new Date(endDate))}
          </p>
          <p>
            <span className="text-app-ink/50">Post filter:</span>{" "}
            {FORWARDED_FILTER_LABELS[forwardedFilter] ?? forwardedFilter}
          </p>
          <p>
            <span className="text-app-ink/50">Keyword:</span>{" "}
            {postSearch.trim() ? `"${postSearch.trim()}"` : "None"}
          </p>
          <p>
            <span className="text-app-ink/50">Forward posts:</span>{" "}
            {forwardPostCount}
          </p>
          <p>
            <span className="text-app-ink/50">Unique sources:</span>{" "}
            {candidates.length}
            {(forwardedFilter === "all" || forwardedFilter === "forwarded") &&
            candidates.length > 0
              ? ` (${unfollowedSourceCount} unfollowed)`
              : null}
          </p>
        </div>
        {semanticSearchQuery?.trim() ? (
          <p className="mt-3 text-xs text-purple-600 dark:text-purple-400">
            Based on semantic search results (up to 50 posts), not your full
            date-range corpus.
          </p>
        ) : null}
      </section>

      <div className="rounded-xl border border-app-ink/10 bg-app-card p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-bold uppercase tracking-widest text-app-ink/70">
            Forward Sources
            {candidates.length > 0 ? (
              <span className="ml-2 font-normal normal-case tracking-normal text-app-ink/60">
                ({candidates.length} source{candidates.length === 1 ? "" : "s"})
              </span>
            ) : null}
          </h3>
          {candidates.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-widest text-app-ink/50">
                Sort by
              </span>
              {DISCOVER_SORT_OPTIONS.map((option) => (
                <TgFilterChip
                  key={option.value}
                  data-testid={`discover-sort-${option.value}`}
                  selected={sortKey === option.value}
                  onClick={() => setSortKey(option.value)}
                >
                  {option.label}
                </TgFilterChip>
              ))}
            </div>
          ) : null}
        </div>

        {candidates.length > 0 && selectedForFollow.size > 0 ? (
          <div
            className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2"
            data-testid="discover-bulk-bar"
          >
            <span className="text-xs font-bold uppercase tracking-wider text-app-ink/70">
              {selectedForFollow.size} selected
            </span>
            <TgButton
              type="button"
              variant="secondary"
              size="sm"
              data-testid="discover-follow-selected"
              disabled={isOffline}
              loading={isFollowJobRunning}
              loadingLabel="Follow selected"
              onClick={() => void handleFollowSelected()}
              className="rounded-full border-blue-500/30 text-blue-600 hover:bg-blue-500/10 dark:text-blue-400"
            >
              <Plus size={12} />
              Follow selected
            </TgButton>
            <TgButton
              type="button"
              variant="secondary"
              size="sm"
              data-testid="discover-clear-selection"
              disabled={isFollowJobRunning}
              onClick={() => setSelectedForFollow(new Set())}
              className="rounded-full text-app-ink/60"
            >
              Clear
            </TgButton>
            {isFollowJobRunning && followProgress ? (
              <span
                className="text-xs text-app-ink/60"
                data-testid="discover-follow-progress"
              >
                Following… {followProgress.completed}/{followProgress.total}
              </span>
            ) : null}
          </div>
        ) : null}

        {isFollowJobRunning &&
        followProgress &&
        selectedForFollow.size === 0 ? (
          <div
            className="mb-3 text-xs text-app-ink/60"
            data-testid="discover-follow-progress"
          >
            Following… {followProgress.completed}/{followProgress.total}
          </div>
        ) : null}

        {candidates.length === 0 && emptyState ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-app-ink">
              {emptyState.title}
            </p>
            <p className="text-sm text-app-ink/60">{emptyState.body}</p>
            {emptyState.quickActions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {emptyState.quickActions.map((quickAction) => (
                  <TgFilterChip
                    key={quickAction.label}
                    onClick={() => runQuickAction(quickAction.action)}
                  >
                    {quickAction.label}
                  </TgFilterChip>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-app-ink/50">
                <tr>
                  <th className="w-10 pb-2">
                    <input
                      ref={headerCheckboxRef}
                      type="checkbox"
                      data-testid="discover-select-all"
                      checked={headerState === "checked"}
                      disabled={
                        isOffline ||
                        isFollowJobRunning ||
                        unfollowedSourceCount === 0
                      }
                      onChange={() =>
                        setSelectedForFollow((prev) =>
                          toggleSelectAllUnfollowed(candidates, prev),
                        )
                      }
                      className="accent-blue-600"
                      aria-label="Select all unfollowed sources"
                    />
                  </th>
                  <th className="pb-2">Channel</th>
                  <th className="pb-2">Posts</th>
                  <th className="pb-2">Forwarded by</th>
                  <th className="pb-2">Last seen</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((row) => {
                  const rowStatus = resultStatusByName.get(row.name)
                  return (
                    <tr key={row.name} className="border-t border-app-ink/10">
                      <td className="py-2 align-middle">
                        <input
                          type="checkbox"
                          data-testid={`discover-select-${row.name}`}
                          checked={isRowCheckboxChecked(
                            row.name,
                            row.isFollowed,
                            selectedForFollow,
                          )}
                          disabled={
                            isOffline ||
                            isRowCheckboxDisabled(
                              row.isFollowed,
                              isFollowJobRunning,
                            )
                          }
                          onChange={() =>
                            setSelectedForFollow((prev) =>
                              toggleUnfollowedSelection(
                                row.name,
                                row.isFollowed,
                                prev,
                              ),
                            )
                          }
                          className="accent-blue-600"
                          aria-label={
                            row.isFollowed
                              ? `@${row.name} already followed`
                              : `Select @${row.name} to follow`
                          }
                        />
                      </td>
                      <td className="py-2">
                        <a
                          href={telegramWebViewChannelUrl(row.name)}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-testid={`discover-channel-link-${row.name}`}
                          className="font-mono text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
                        >
                          @{row.name}
                        </a>
                        {row.displayName ? (
                          <div className="text-xs text-app-ink/60">
                            {row.displayName}
                          </div>
                        ) : null}
                        {rowStatus &&
                        rowStatus !== "pending" &&
                        isFollowJobRunning ? (
                          <div className="mt-0.5 text-[10px] uppercase tracking-wider text-app-ink/50">
                            {rowStatus}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2">{row.postCount}</td>
                      <td className="py-2">
                        {row.forwardedBy.map((entry, index) => (
                          <span key={entry.channelName}>
                            {index > 0 ? ", " : null}
                            <a
                              href={telegramWebViewChannelUrl(
                                entry.channelName,
                              )}
                              target="_blank"
                              rel="noopener noreferrer"
                              data-testid={`discover-forwarded-by-link-${entry.channelName}`}
                              className="font-mono text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
                            >
                              @{entry.channelName}
                            </a>
                            {` (${entry.count})`}
                          </span>
                        ))}
                      </td>
                      <td className="py-2">
                        <RelativeTime timestamp={row.lastSeen} />
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {row.isFollowed ? (
                            <span className="rounded-full bg-app-muted/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-app-ink/60">
                              Following
                            </span>
                          ) : (
                            <TgButton
                              type="button"
                              variant="secondary"
                              size="sm"
                              data-testid={`discover-follow-${row.name}`}
                              disabled={isOffline || isFollowJobRunning}
                              loading={activeFollowNames.includes(row.name)}
                              loadingLabel="Follow"
                              onClick={() => void handleFollow(row.name)}
                              className="rounded-full border-blue-500/30 text-blue-600 hover:bg-blue-500/10 dark:text-blue-400"
                            >
                              <Plus size={12} />
                              Follow
                            </TgButton>
                          )}
                          <TgButton
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                              handleViewPosts(row.name, row.isFollowed)
                            }
                            className="rounded-full text-app-ink/70"
                          >
                            View posts
                          </TgButton>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TgConfirmDialog
        open={pendingFollowNames !== null}
        onOpenChange={(open) => {
          if (!open) setPendingFollowNames(null)
        }}
        title="Follow channels?"
        description={
          pendingFollowNames
            ? `Follow ${pendingFollowNames.length} channels? This will scrape and add each selected source.`
            : ""
        }
        confirmLabel="Follow"
        onConfirm={() => {
          const names = pendingFollowNames ?? []
          setPendingFollowNames(null)
          void executeFollow(names)
        }}
        onCancel={() => setPendingFollowNames(null)}
      />
    </motion.div>
  )
}
