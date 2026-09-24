import { ExternalLink, Plus, RefreshCw } from "lucide-react"
import type React from "react"
import type { DirectorySamplePostResponse } from "@/client"
import { RelativeTime } from "@/components/RelativeTime"
import { TgButton } from "@/components/ui/tg-button"
import { formatCount } from "@/lib/format-count"
import {
  DISCOVERY_SIGNAL_KINDS,
  DISCOVERY_SIGNAL_LABELS,
  type DiscoveryCandidate,
} from "@/lib/posts/discover-candidates"
import {
  candidateStatistics,
  panelStatistics,
} from "@/lib/posts/discover-statistics"
import {
  telegramWebViewChannelUrl,
  telegramWebViewPostUrl,
} from "@/lib/telegram-web"
import { DiscoverMediaMixBar } from "./DiscoverMediaMixBar"

const HEADING =
  "mb-2 text-[11px] font-bold uppercase tracking-widest text-app-ink/50"
const LINK =
  "inline-flex items-center gap-1 text-xs text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
const Dash = () => <span className="text-app-ink/40">—</span>

/**
 * One labelled statistic, or the em dash that stands for "not measured".
 *
 * The dash rather than a zero, and the `title` says which of the three blanks
 * it is. Zero Posts a week and no measurement are different claims, and the
 * whole point of the row's statistics is that a Channel nobody has looked at
 * must not read as a Channel with bad numbers.
 */
const Stat: React.FC<{
  label: string
  value?: string | number | null
  title?: string
  children?: React.ReactNode
}> = ({ label, value = null, title, children }) => (
  <div>
    <div className="text-[10px] font-bold uppercase tracking-wider text-app-ink/50">
      {label}
    </div>
    <div className="tabular-nums" title={title}>
      {children ?? (value === null || value === "" ? <Dash /> : value)}
    </div>
  </div>
)

/** Following, or a Follow button. */
export function FollowControl({
  name,
  isFollowed,
  disabled,
  following,
  onFollow,
}: {
  name: string
  isFollowed: boolean
  disabled: boolean
  /** A follow for this handle is already running. */
  following: boolean
  onFollow: () => void
}) {
  if (isFollowed)
    return (
      <span
        className="rounded-full bg-app-muted/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-app-ink/60"
        data-testid="discover-panel-following"
      >
        Following
      </span>
    )
  return (
    <TgButton
      type="button"
      variant="primary"
      size="sm"
      disabled={disabled}
      loading={following}
      loadingLabel="Follow"
      onClick={onFollow}
      data-testid={`discover-panel-follow-${name}`}
      className="rounded-full"
    >
      <Plus size={12} />
      Follow
    </TgButton>
  )
}

/** The Channel's measured statistics, or why there are none, and the recheck. */
export function ChannelStatistics({
  candidate,
  recheckDisabled,
  onRecheck,
}: {
  candidate: DiscoveryCandidate
  recheckDisabled: boolean
  onRecheck: () => void
}) {
  const probe = candidate.probe ?? null
  const stats = candidateStatistics(probe)
  const panel = panelStatistics(probe)
  return (
    <section data-testid="discover-panel-statistics">
      <h4 className={HEADING}>Channel</h4>
      {probe ? (
        <div className="space-y-3 text-sm">
          {/*
           * The row's four, repeated rather than referred to. The sheet covers
           * the row it was opened from, so omitting them would mean closing it
           * to recheck a number — which makes duplication in a detail view
           * context rather than redundancy.
           */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Last post" title={stats.placeholderTitle}>
              {stats.lastPostAt === null ? (
                <Dash />
              ) : (
                <RelativeTime timestamp={stats.lastPostAt} />
              )}
            </Stat>
            {/* The one counter here, and it goes blank for the other reason: it
             * is a snapshot of the preview page, so an entry Telegram stopped
             * serving loses it along with the mix and the density.
             * `placeholderTitle` explains the sample-derived blanks and would
             * be the wrong sentence. */}
            <Stat
              label="Subscribers"
              value={
                probe.subscribers != null
                  ? formatCount(probe.subscribers)
                  : null
              }
              title="As Telegram renders it. Cleared for a Channel it has stopped serving, alongside the media mix and density."
            />
            <Stat
              label="Posts / week"
              value={stats.postsPerWeek ?? stats.sampleNote}
              title={stats.placeholderTitle}
            />
            <Stat
              label="Median views"
              value={stats.medianViews}
              title={stats.placeholderTitle}
            />
          </div>
          {/*
           * The three that would not fit on a row. Forward share and Language
           * are stored at probe time; density is derived at read from the
           * counters.
           */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Forwarded"
              value={panel.forwardShare}
              title="Share of the sample Posts carrying a forward attribution — an aggregator reposts, an original source does not"
            />
            <Stat
              label="Language"
              value={panel.language}
              title="The language the Channel's sample Posts are written in, read from its own words; forwards count only when it has none"
            />
            <Stat
              label="Media / post"
              value={panel.mediaDensity}
              title="Media items per published Post id. A rate, and it may exceed 1: an album of five photos adds five items against one id. Absent for a Channel Telegram has stopped serving, whose counters went with its page."
            />
            <Stat
              label="Mix"
              title="Shares of the four media counters against each other, not of the Post count. Absent with the density, and for the same reason."
            >
              {probe.mediaMix ? (
                <DiscoverMediaMixBar
                  mix={probe.mediaMix}
                  handle={`panel-${candidate.name}`}
                />
              ) : (
                <Dash />
              )}
            </Stat>
          </div>
        </div>
      ) : (
        <p
          className="text-sm text-app-ink/60"
          data-testid="discover-panel-not-probed"
        >
          Not probed yet. Nothing has fetched this handle, so there is no
          measurement to show — this is the absence of a number, not a bad one.
        </p>
      )}
      {/*
       * Offered whether or not a verdict exists, which is the half the row
       * cannot do: an unprobed Candidate is exactly the one somebody opens the
       * panel to ask about, and the sweep may be a long way down the queue.
       */}
      <TgButton
        type="button"
        variant="secondary"
        size="sm"
        className="mt-3 rounded-full text-app-ink/60"
        data-testid="discover-panel-recheck"
        disabled={recheckDisabled}
        onClick={onRecheck}
        title="Queue this handle to be checked on Telegram — the sweep decides when, so nothing is fetched now"
      >
        <RefreshCw size={12} />
        {probe ? "Recheck" : "Check this handle"}
      </TgButton>
    </section>
  )
}

/** Per-signal reference counts and their total. */
export function SignalCounts({ candidate }: { candidate: DiscoveryCandidate }) {
  return (
    <section>
      <h4 className={HEADING}>Signals</h4>
      <div className="flex flex-wrap gap-3 text-sm">
        {DISCOVERY_SIGNAL_KINDS.map((kind) => (
          <span key={kind} className="tabular-nums">
            <span className="text-app-ink/50">
              {DISCOVERY_SIGNAL_LABELS[kind]}:
            </span>{" "}
            {candidate.counts[kind]}
          </span>
        ))}
        <span className="font-bold tabular-nums">
          <span className="text-app-ink/50">Total:</span> {candidate.total}
        </span>
      </div>
    </section>
  )
}

/** The followed channels that referenced this handle, each with its count. */
export function SeenBy({ candidate }: { candidate: DiscoveryCandidate }) {
  return (
    <section>
      <h4 className={HEADING}>Seen by ({candidate.seenInCount})</h4>
      <ul className="space-y-1 text-sm">
        {candidate.seenIn.map((entry) => (
          <li key={entry.channelName}>
            <a
              href={telegramWebViewChannelUrl(entry.channelName)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
            >
              @{entry.channelName}
            </a>
            <span className="text-app-ink/60"> ({entry.total})</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The Channel's own sample Posts, once the disclosure has fetched them.
 *
 * One line for both empties, because the reader cannot act on the difference.
 * `200 []` is a probed entry whose snapshot went with an `unavailable` verdict
 * or aged out on the sample window; 404 is a handle nothing has ever stored
 * Posts for. The failing case is folded in with them: the only error this
 * route produces by design is that 404, and a section decorating a snapshot is
 * not where a dead deployment should be reported.
 */
export function RecentPosts({
  handle,
  loading,
  posts,
}: {
  handle: string
  loading: boolean
  posts: DirectorySamplePostResponse[]
}) {
  if (loading) return <p className="text-sm text-app-ink/50">Loading posts…</p>
  if (posts.length === 0)
    return (
      <p
        className="text-sm text-app-ink/50"
        data-testid="discover-panel-posts-empty"
      >
        No sample posts stored for this Channel.
      </p>
    )
  return (
    <>
      {posts.map((post) => (
        <article
          key={post.postId}
          className="rounded-lg border border-app-ink/10 bg-app-muted/30 p-3"
          data-testid={`discover-panel-post-${post.postId}`}
        >
          <div className="mb-1 flex items-center gap-2 text-xs text-app-ink/60">
            <RelativeTime timestamp={post.timestamp} />
            {/* `null` is *not measured*: Telegram stops rendering the counter
             * on older Posts, which is the same absence the median has a
             * threshold for. A zero here would be a claim. */}
            {post.views != null && (
              <span className="tabular-nums">
                {formatCount(post.views)} views
              </span>
            )}
            <a
              href={telegramWebViewPostUrl(handle, post.postId)}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
            >
              <ExternalLink size={12} />
              Open
            </a>
          </div>
          {/* Clamped in CSS rather than truncated server-side. Four lines is
           * enough to judge what a Channel writes about, and the whole body
           * already travelled — so lifting the clamp later is a class, not a
           * second route. "Open" is the full read. */}
          <p dir="auto" className="line-clamp-4 whitespace-pre-wrap text-sm">
            {post.text || "(no text)"}
          </p>
        </article>
      ))}
    </>
  )
}

export type ReferenceView =
  | "none"
  | "loading"
  | "text"
  | "pruned"
  | "unavailable"

/**
 * What the Most recent reference section shows.
 *
 * Retention prunes posts; a saved report outlives them by design. Absence is
 * an expected state, not an error — the Telegram link still works. It is told
 * apart from a failed lookup and from a post that survived with no text, both
 * of which say less.
 */
export function referenceView(state: {
  hasReference: boolean
  loading: boolean
  failed: boolean
  /** The lookup found the post, whether or not it has text. */
  found: boolean
  text: string | null | undefined
}): ReferenceView {
  if (!state.hasReference) return "none"
  if (state.loading) return "loading"
  if (state.text) return "text"
  return state.failed || state.found ? "unavailable" : "pruned"
}

export { LINK as PANEL_LINK_CLASS }
