import { Compass, Plus } from "lucide-react"
import { motion } from "motion/react"
import type React from "react"
import { useMemo } from "react"
import {
  type DiscoveryQuickAction,
  FORWARDED_FILTER_LABELS,
  resolveDiscoveryEmptyState,
} from "@/lib/posts/discover-empty-state"
import {
  computeForwardSourceDiscovery,
  countForwardPosts,
  countUnfollowedSources,
} from "@/lib/posts/discover-forward-sources"
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
    addNewChannel,
    setPostSearch,
  } = useScraper()
  const { setActiveTab, startDate, endDate } = useUI()
  const { isOffline } = useApiStatus()

  const { candidates, emptyReason } = useMemo(
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

  const emptyState = resolveDiscoveryEmptyState(emptyReason)
  const forwardPostCount = useMemo(
    () => countForwardPosts(filteredPosts),
    [filteredPosts],
  )
  const unfollowedSourceCount = useMemo(
    () => countUnfollowedSources(candidates),
    [candidates],
  )

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

  const handleFollow = async (name: string) => {
    const candidate = candidates.find((row) => row.name === name)
    if (!candidate || candidate.isFollowed) return
    await addNewChannel(name, candidate.samplePost)
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
        <h3 className="mb-3 text-sm font-bold uppercase tracking-widest text-app-ink/70">
          Forward Sources
          {candidates.length > 0 ? (
            <span className="ml-2 font-normal normal-case tracking-normal text-app-ink/60">
              ({candidates.length} source{candidates.length === 1 ? "" : "s"})
            </span>
          ) : null}
        </h3>

        {candidates.length === 0 && emptyState ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-app-ink">
              {emptyState.title}
            </p>
            <p className="text-sm text-app-ink/60">{emptyState.body}</p>
            {emptyState.quickActions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {emptyState.quickActions.map((quickAction) => (
                  <button
                    key={quickAction.label}
                    type="button"
                    onClick={() => runQuickAction(quickAction.action)}
                    className="rounded-full border border-app-ink/20 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-app-ink transition-colors hover:bg-app-muted/30"
                  >
                    {quickAction.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-app-ink/50">
                <tr>
                  <th className="pb-2">Channel</th>
                  <th className="pb-2">Posts</th>
                  <th className="pb-2">Forwarded by</th>
                  <th className="pb-2">Last seen</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((row) => (
                  <tr key={row.name} className="border-t border-app-ink/10">
                    <td className="py-2">
                      <div className="font-mono">@{row.name}</div>
                      {row.displayName ? (
                        <div className="text-xs text-app-ink/60">
                          {row.displayName}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2">{row.postCount}</td>
                    <td className="py-2">
                      {row.forwardedBy
                        .map(
                          (entry) => `@${entry.channelName} (${entry.count})`,
                        )
                        .join(", ")}
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
                          <button
                            type="button"
                            disabled={isOffline}
                            onClick={() => void handleFollow(row.name)}
                            className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-blue-600 transition-colors hover:bg-blue-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-blue-400"
                          >
                            <Plus size={12} />
                            Follow
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            handleViewPosts(row.name, row.isFollowed)
                          }
                          className="rounded-full border border-app-ink/20 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-app-ink/70 transition-colors hover:bg-app-muted/30"
                        >
                          View posts
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  )
}
