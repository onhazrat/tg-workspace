import { Plus } from "lucide-react"
import type React from "react"
import { useEffect, useRef } from "react"
import { RelativeTime } from "@/components/RelativeTime"
import { TgButton } from "@/components/ui/tg-button"
import type {
  DiscoveryCandidate,
  DiscoverySignalKind,
} from "@/lib/posts/discover-candidates"
import {
  headerCheckboxState,
  isRowCheckboxChecked,
  isRowCheckboxDisabled,
  toggleSelectAllUnfollowed,
  toggleUnfollowedSelection,
} from "@/lib/posts/discover-selection"
import { telegramWebViewChannelUrl } from "@/lib/telegram-web"

/** Count cells render a dash for zero so non-zero signals stand out when scanning. */
const CountCell: React.FC<{ value: number; testId: string }> = ({
  value,
  testId,
}) => (
  <td
    className={
      value > 0 ? "py-2 tabular-nums" : "py-2 tabular-nums text-app-ink/30"
    }
    data-testid={testId}
  >
    {value > 0 ? value : "–"}
  </td>
)

interface DiscoverCandidateTableProps {
  candidates: DiscoveryCandidate[]
  selectedForFollow: Set<string>
  setSelectedForFollow: React.Dispatch<React.SetStateAction<Set<string>>>
  unfollowedCount: number
  isOffline: boolean
  isFollowJobRunning: boolean
  activeFollowNames: string[]
  resultStatusByName: Map<string, string>
  onFollow: (name: string) => void
  /**
   * Open the candidate's evidence panel.
   *
   * Replaces the old "View posts" navigation, which wrote shared Posts-tab
   * scope state and thereby discarded the report being read (IDEA-011 D1).
   */
  onInspect: (candidate: DiscoveryCandidate) => void
}

export const DiscoverCandidateTable: React.FC<DiscoverCandidateTableProps> = ({
  candidates,
  selectedForFollow,
  setSelectedForFollow,
  unfollowedCount,
  isOffline,
  isFollowJobRunning,
  activeFollowNames,
  resultStatusByName,
  onFollow,
  onInspect,
}) => {
  const headerCheckboxRef = useRef<HTMLInputElement>(null)
  const headerState = headerCheckboxState(candidates, selectedForFollow)

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = headerState === "indeterminate"
    }
  }, [headerState])

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="text-[11px] uppercase tracking-wider text-app-ink/50">
          <tr>
            <th className="w-10 pb-2">
              <input
                ref={headerCheckboxRef}
                type="checkbox"
                data-testid="discover-select-all"
                checked={headerState === "checked"}
                disabled={
                  isOffline || isFollowJobRunning || unfollowedCount === 0
                }
                onChange={() =>
                  setSelectedForFollow((prev) =>
                    toggleSelectAllUnfollowed(candidates, prev),
                  )
                }
                className="accent-blue-600"
                aria-label="Select all unfollowed candidates"
              />
            </th>
            <th className="pb-2">Channel</th>
            <th className="pb-2" title="Forwards">
              Fwd
            </th>
            <th className="pb-2" title="Mentions">
              Men
            </th>
            <th className="pb-2" title="Links">
              Link
            </th>
            <th className="pb-2">Total</th>
            <th className="pb-2">Seen by</th>
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
                      isRowCheckboxDisabled(row.isFollowed, isFollowJobRunning)
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
                {(["forward", "mention", "link"] as DiscoverySignalKind[]).map(
                  (kind) => (
                    <CountCell
                      key={kind}
                      value={row.counts[kind]}
                      testId={`discover-count-${kind}-${row.name}`}
                    />
                  ),
                )}
                <td
                  className="py-2 font-bold tabular-nums"
                  data-testid={`discover-count-total-${row.name}`}
                >
                  {row.total}
                </td>
                <td className="py-2">
                  {row.seenIn.map((entry, index) => (
                    <span key={entry.channelName}>
                      {index > 0 ? ", " : null}
                      <a
                        href={telegramWebViewChannelUrl(entry.channelName)}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid={`discover-seen-in-link-${entry.channelName}`}
                        className="font-mono text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
                      >
                        @{entry.channelName}
                      </a>
                      {` (${entry.total})`}
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
                        onClick={() => onFollow(row.name)}
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
                      data-testid={`discover-inspect-${row.name}`}
                      onClick={() => onInspect(row)}
                      className="rounded-full text-app-ink/70"
                    >
                      Details
                    </TgButton>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
