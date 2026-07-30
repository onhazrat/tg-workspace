import { EyeOff, Plus, RefreshCw, Undo2 } from "lucide-react"
import type React from "react"
import { useEffect, useRef, useState } from "react"
import { RelativeTime } from "@/components/RelativeTime"
import { TgButton } from "@/components/ui/tg-button"
import {
  DISCOVER_PROBE_KIND_LABELS,
  type DiscoverSignalWeights,
  type DiscoveryCandidate,
  type DiscoverySignalKind,
  weightedScore,
} from "@/lib/posts/discover-candidates"
import {
  headerCheckboxState,
  isRowCheckboxChecked,
  isRowCheckboxDisabled,
  selectRange,
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

/**
 * What a probe concluded about a handle, as a small badge beside its name.
 *
 * Only rendered once a probe has *concluded*: an unprobed handle shows nothing
 * rather than a placeholder, because a sweep is asynchronous and a row that
 * simply has not been reached yet must not read as a finding.
 *
 * `ok` is silent too — "this is a channel" is the assumption every row already
 * carries, so badging it would put a label on almost every line and make the
 * ones that matter harder to spot.
 */
const ProbeBadge: React.FC<{ candidate: DiscoveryCandidate }> = ({
  candidate,
}) => {
  const probe = candidate.probe
  if (probe?.status !== "unavailable") return null
  return (
    <span
      className="ml-2 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400"
      data-testid={`discover-probe-kind-${candidate.name}`}
      title={
        probe.kind === "unknown"
          ? "Telegram has no public feed for this handle, so it cannot be followed"
          : `Telegram reports this handle as a ${DISCOVER_PROBE_KIND_LABELS[probe.kind].toLowerCase()}, which cannot be followed`
      }
    >
      {DISCOVER_PROBE_KIND_LABELS[probe.kind]}
    </span>
  )
}

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
  /** Dismiss (or restore) a candidate. */
  onSetIgnored: (name: string, ignored: boolean) => void
  /**
   * Re-probe a handle, discarding its cached verdict.
   *
   * Offered per row rather than only in bulk because the case that motivates it
   * is singular: the operator recognises one specific handle as a channel that
   * has been misjudged.
   */
  onRecheck: (name: string) => void
  isRecheckPending: boolean
  weights: DiscoverSignalWeights
  /**
   * Show the weighted score column.
   *
   * Only while sorting by it: otherwise the ordering would be driven by a
   * number the table never shows, which is what makes a weighted rank feel
   * arbitrary.
   */
  showScore: boolean
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
  onSetIgnored,
  onRecheck,
  isRecheckPending,
  weights,
  showScore,
}) => {
  const headerCheckboxRef = useRef<HTMLInputElement>(null)
  const headerState = headerCheckboxState(candidates, selectedForFollow)

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = headerState === "indeterminate"
    }
  }, [headerState])

  /**
   * Whether shift was held for the click currently being processed.
   *
   * `onChange` carries no modifier keys, and `onClick` on a checkbox runs
   * before the change is dispatched, so the flag is captured there and read a
   * moment later.
   */
  const shiftHeldRef = useRef(false)

  /**
   * The row a range extends *from* — the last row toggled without shift.
   *
   * Stored by name rather than index so sorting or filtering between two
   * clicks cannot silently move the anchor to a different channel.
   */
  const [anchorName, setAnchorName] = useState<string | null>(null)

  const handleRowToggle = (row: DiscoveryCandidate, index: number) => {
    const anchorIndex =
      anchorName === null
        ? -1
        : candidates.findIndex((c) => c.name === anchorName)

    if (shiftHeldRef.current && anchorIndex >= 0 && anchorIndex !== index) {
      const shouldSelect = !selectedForFollow.has(row.name)
      setSelectedForFollow((prev) =>
        selectRange(candidates, anchorIndex, index, prev, shouldSelect),
      )
      // The anchor stays put, so repeated shift-clicks grow and shrink one
      // range instead of chaining new ones from wherever you last landed.
      return
    }

    setSelectedForFollow((prev) =>
      toggleUnfollowedSelection(row.name, row.isFollowed, prev),
    )
    setAnchorName(row.name)
  }

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
            {showScore ? (
              <th
                className="pb-2"
                title={`Weighted: ${weights.forward}×Fwd + ${weights.mention}×Men + ${weights.link}×Link`}
              >
                Score
              </th>
            ) : null}
            <th className="pb-2">Seen by</th>
            <th className="pb-2">Last seen</th>
            <th className="pb-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((row, index) => {
            const rowStatus = resultStatusByName.get(row.name)
            const metaName = row.displayName || row.probe?.displayName || ""
            const subscribers = row.probe?.subscribers || ""
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
                    onClick={(event) => {
                      shiftHeldRef.current = event.shiftKey
                    }}
                    onChange={() => handleRowToggle(row, index)}
                    className="accent-blue-600"
                    title="Shift-click to select a range"
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
                  <ProbeBadge candidate={row} />
                  {/*
                   * Name and count are separate bidi isolates.
                   *
                   * A Persian channel name is an RTL run inside an LTR line. As
                   * one concatenated string the neutral separator and the ASCII
                   * count get absorbed into that run and reorder — the count
                   * lands to the left of the name, and punctuation at the edge
                   * of the name jumps sides. `dir="auto"` resolves each run's
                   * direction from its own first strong character and, per
                   * HTML's default stylesheet, isolates it, so the line always
                   * reads name · count regardless of script. Same treatment as
                   * `PostCard` and `ChannelCard`.
                   *
                   * The count also renders when the name is missing, which the
                   * single combined condition used to suppress.
                   */}
                  {metaName || subscribers ? (
                    <div className="text-xs text-app-ink/60">
                      {metaName ? <span dir="auto">{metaName}</span> : null}
                      {metaName && subscribers ? " · " : null}
                      {subscribers ? (
                        <span dir="auto">{subscribers} subscribers</span>
                      ) : null}
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
                {showScore ? (
                  <td
                    className="py-2 font-bold tabular-nums text-blue-600 dark:text-blue-400"
                    data-testid={`discover-score-${row.name}`}
                  >
                    {weightedScore(row, weights)}
                  </td>
                ) : null}
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
                    {/*
                     * Dismissing is offered even for followed candidates: a
                     * channel can be worth following and still be noise in the
                     * report you scan each week.
                     */}
                    <TgButton
                      type="button"
                      variant="secondary"
                      size="sm"
                      data-testid={`discover-ignore-${row.name}`}
                      onClick={() => onSetIgnored(row.name, !row.isIgnored)}
                      title={
                        row.isIgnored
                          ? "Show this channel in reports again"
                          : "Hide this channel from future reports"
                      }
                      className="rounded-full text-app-ink/60"
                    >
                      {row.isIgnored ? (
                        <>
                          <Undo2 size={12} />
                          Restore
                        </>
                      ) : (
                        <>
                          <EyeOff size={12} />
                          Dismiss
                        </>
                      )}
                    </TgButton>
                    {/*
                     * Offered only where a verdict exists to overturn. On an
                     * unprobed row there is nothing cached to discard, and the
                     * sweep will reach it on its own.
                     */}
                    {row.probe ? (
                      <TgButton
                        type="button"
                        variant="secondary"
                        size="sm"
                        data-testid={`discover-recheck-${row.name}`}
                        disabled={isOffline || isRecheckPending}
                        onClick={() => onRecheck(row.name)}
                        title="Check this handle on Telegram again"
                        className="rounded-full text-app-ink/60"
                      >
                        <RefreshCw size={12} />
                        Recheck
                      </TgButton>
                    ) : null}
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
