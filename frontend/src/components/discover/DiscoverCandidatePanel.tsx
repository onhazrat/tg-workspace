import { useQuery } from "@tanstack/react-query"
import { ExternalLink, Plus, RefreshCw } from "lucide-react"
import type React from "react"
import { useEffect, useState } from "react"
import { api } from "@/api"
import { dataGetDirectoryPosts } from "@/client"
import { RelativeTime } from "@/components/RelativeTime"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { TgButton } from "@/components/ui/tg-button"
import { queryKeys } from "@/hooks/queryKeys"
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

/** Compact, the way the row's median views are formatted. */
const VIEWS = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
})

interface DiscoverCandidatePanelProps {
  candidate: DiscoveryCandidate | null
  onClose: () => void
  isOffline: boolean
  isFollowJobRunning: boolean
  onFollow: (name: string) => void
  /**
   * Discard this handle's cached verdict and put it back at the front of the
   * queue.
   *
   * Offered here **unconditionally**, where the row offers it only once a
   * verdict exists to overturn (ticket 03). A Candidate with no Directory entry
   * is exactly the row somebody opens the panel to ask about, and the service
   * already creates the row it needs — an unprobed handle is a reasonable thing
   * to ask for, not an error.
   */
  onRecheck: (name: string) => void
  isRecheckPending: boolean
}

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
      {children ??
        (value === null || value === "" ? (
          <span className="text-app-ink/40">—</span>
        ) : (
          value
        ))}
    </div>
  </div>
)

/**
 * Evidence for one candidate, over the report rather than instead of it.
 *
 * Inspecting a candidate used to mean navigating to the Posts tab, which wrote
 * shared scope state and discarded the report you were reading (IDEA-011 D1).
 * A panel keeps the report on screen and puts the deciding information — the
 * post that actually produced the reference — next to the counts.
 */
export const DiscoverCandidatePanel: React.FC<DiscoverCandidatePanelProps> = ({
  candidate,
  onClose,
  isOffline,
  isFollowJobRunning,
  onFollow,
  onRecheck,
  isRecheckPending,
}) => {
  const reference = candidate?.reference ?? null
  const probe = candidate?.probe ?? null
  const stats = candidateStatistics(probe)
  const panel = panelStatistics(probe)

  /**
   * The disclosure, controlled so the fetch can hang off it.
   *
   * Closed by default because the statistics are what the panel was opened
   * for, and twenty Post bodies above them is a wall of text in front of the
   * answer. Keeping the state here rather than letting `<details>` own it buys
   * one thing: the bodies are not fetched at all for the ordinary open-read-
   * close, which is most of triage.
   */
  const [postsOpen, setPostsOpen] = useState(false)
  // A sheet that stays mounted between Candidates would otherwise open the next
  // one already expanded, onto the previous handle's Posts while the new ones
  // load.
  useEffect(() => setPostsOpen(false), [candidate?.name])

  /**
   * The Channel's own recent Posts, off the Directory rather than the report.
   *
   * Its own resource family and its own read: forty Candidates times twenty
   * bodies on the report is the 26 MB and 56 MB payloads a third time. **No
   * Telegram request happens here** — this is the snapshot the last probe
   * stored, and the way to get a fresher one is the recheck below, which goes
   * through the queue that decides ordering.
   *
   * Not gated on `probe`. A rechecked handle has no verdict and **does** still
   * have its Posts — `requeue_probes` keeps the snapshot on purpose — so asking
   * only where a verdict exists would hide exactly the rows the server went out
   * of its way to preserve. The route answers 404 where there is genuinely
   * nothing, and `retry: false` keeps that from being asked three times.
   */
  const postsQuery = useQuery({
    queryKey: queryKeys.directoryPosts(candidate?.name ?? ""),
    queryFn: () => dataGetDirectoryPosts({ path: { handle: candidate!.name } }),
    enabled: Boolean(candidate && postsOpen),
    retry: false,
  })
  const posts = postsQuery.data ?? []

  // Fetched lazily rather than stored in the report: only the pointer is
  // persisted, so a report stays small and never carries a stale copy of a post
  // that has since been edited.
  const referenceQuery = useQuery({
    queryKey: [
      "discoverReferencePost",
      reference?.channelName ?? "",
      reference?.postId ?? 0,
    ],
    queryFn: () =>
      api.lookupPosts([
        { channelName: reference!.channelName, postId: reference!.postId },
      ]),
    enabled: Boolean(reference),
  })

  const post = referenceQuery.data?.[0] ?? null
  // Retention prunes posts; a saved report outlives them by design. Absence is
  // an expected state, not an error — the Telegram link below still works.
  const referencePruned = Boolean(
    reference && !referenceQuery.isLoading && !referenceQuery.isError && !post,
  )

  return (
    <Sheet
      open={candidate !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto sm:max-w-md"
        data-testid="discover-candidate-panel"
      >
        {candidate ? (
          <>
            <SheetHeader>
              <SheetTitle className="font-mono">@{candidate.name}</SheetTitle>
              {/* dir="auto" for the same reason as in the table: a Persian
               * display name renders its own punctuation on the wrong side
               * when it inherits the page's LTR direction. */}
              <SheetDescription dir="auto">
                {candidate.displayName ?? "Referenced by your channels"}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-5 px-4 pb-6">
              <div className="flex flex-wrap items-center gap-2">
                {candidate.isFollowed ? (
                  <span
                    className="rounded-full bg-app-muted/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-app-ink/60"
                    data-testid="discover-panel-following"
                  >
                    Following
                  </span>
                ) : (
                  <TgButton
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={isOffline || isFollowJobRunning}
                    onClick={() => onFollow(candidate.name)}
                    data-testid={`discover-panel-follow-${candidate.name}`}
                    className="rounded-full"
                  >
                    <Plus size={12} />
                    Follow
                  </TgButton>
                )}
                <a
                  href={telegramWebViewChannelUrl(candidate.name)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
                >
                  <ExternalLink size={12} />
                  Open on Telegram
                </a>
              </div>

              <section data-testid="discover-panel-statistics">
                <h4 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-app-ink/50">
                  Channel
                </h4>
                {probe ? (
                  <div className="space-y-3 text-sm">
                    {/*
                     * The row's four, repeated rather than referred to. The
                     * sheet covers the row it was opened from, so omitting
                     * them would mean closing it to recheck a number — which
                     * makes duplication in a detail view context rather than
                     * redundancy.
                     */}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Stat label="Last post" title={stats.placeholderTitle}>
                        {stats.lastPostAt === null ? (
                          <span className="text-app-ink/40">—</span>
                        ) : (
                          <RelativeTime timestamp={stats.lastPostAt} />
                        )}
                      </Stat>
                      {/* The one counter here, and it goes blank for the other
                       * reason: it is a snapshot of the preview page, so an
                       * entry Telegram stopped serving loses it along with the
                       * mix and the density. `placeholderTitle` explains the
                       * sample-derived blanks and would be the wrong sentence. */}
                      <Stat
                        label="Subscribers"
                        value={probe.subscribers}
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
                     * The three that would not fit on a row. Forward share
                     * and script have been stored since ticket 02 and shown
                     * nowhere; density is derived at read from the counters.
                     */}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Stat
                        label="Forwarded"
                        value={panel.forwardShare}
                        title="Share of the sample Posts carrying a forward attribution — an aggregator reposts, an original source does not"
                      />
                      <Stat
                        label="Script"
                        value={panel.script}
                        title="The alphabet the sample captions are written in — a script, not a language"
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
                          <span className="text-app-ink/40">—</span>
                        )}
                      </Stat>
                    </div>
                  </div>
                ) : (
                  <p
                    className="text-sm text-app-ink/60"
                    data-testid="discover-panel-not-probed"
                  >
                    Not probed yet. Nothing has fetched this handle, so there is
                    no measurement to show — this is the absence of a number,
                    not a bad one.
                  </p>
                )}
                {/*
                 * Offered whether or not a verdict exists, which is the half
                 * the row cannot do: an unprobed Candidate is exactly the one
                 * somebody opens the panel to ask about, and the sweep may be
                 * a long way down the queue.
                 */}
                <TgButton
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-3 rounded-full text-app-ink/60"
                  data-testid="discover-panel-recheck"
                  disabled={isOffline || isRecheckPending}
                  onClick={() => onRecheck(candidate.name)}
                  title="Queue this handle to be checked on Telegram — the sweep decides when, so nothing is fetched now"
                >
                  <RefreshCw size={12} />
                  {probe ? "Recheck" : "Check this handle"}
                </TgButton>
              </section>

              <section>
                <h4 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-app-ink/50">
                  Signals
                </h4>
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
                    <span className="text-app-ink/50">Total:</span>{" "}
                    {candidate.total}
                  </span>
                </div>
              </section>

              <section>
                <h4 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-app-ink/50">
                  Seen by ({candidate.seenInCount})
                </h4>
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

              <section>
                <h4 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-app-ink/50">
                  Most recent reference
                </h4>
                {reference ? (
                  <div className="space-y-2">
                    <p className="text-xs text-app-ink/60">
                      in{" "}
                      <span className="font-mono">
                        @{reference.channelName}
                      </span>{" "}
                      · <RelativeTime timestamp={reference.timestamp} />
                    </p>
                    {referenceQuery.isLoading ? (
                      <p className="text-sm text-app-ink/50">Loading post…</p>
                    ) : post?.text ? (
                      <blockquote
                        dir="auto"
                        className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-app-ink/10 bg-app-muted/30 p-3 text-sm"
                        data-testid="discover-panel-reference-text"
                      >
                        {post.text}
                      </blockquote>
                    ) : (
                      <p
                        className="text-sm text-app-ink/50"
                        data-testid="discover-panel-reference-missing"
                      >
                        {referencePruned
                          ? "This post is no longer in your corpus. Open it on Telegram to read it."
                          : "Post text unavailable."}
                      </p>
                    )}
                    <a
                      href={telegramWebViewPostUrl(
                        reference.channelName,
                        reference.postId,
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="discover-panel-reference-link"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
                    >
                      <ExternalLink size={12} />
                      View this post on Telegram
                    </a>
                  </div>
                ) : (
                  <p className="text-sm text-app-ink/50">
                    No reference recorded.
                  </p>
                )}
              </section>

              {/*
               * The Channel's own Posts, last and behind a disclosure.
               *
               * Last because the Reference — the Post in a Channel you follow
               * that named this handle — is why the Candidate is on the report
               * at all, and these never displace it. Behind a disclosure
               * because twenty bodies open by default is a wall of text in
               * front of the statistics somebody opened the panel to read.
               *
               * A native `<details>`: it is a disclosure, the platform has
               * one, and it keeps its keyboard and screen-reader behaviour
               * without a line of ours.
               */}
              <details
                open={postsOpen}
                onToggle={(event) => setPostsOpen(event.currentTarget.open)}
                data-testid="discover-panel-posts"
              >
                <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-widest text-app-ink/50">
                  Recent posts
                </summary>
                <div className="mt-2 space-y-3">
                  {postsQuery.isLoading ? (
                    <p className="text-sm text-app-ink/50">Loading posts…</p>
                  ) : posts.length === 0 ? (
                    /*
                     * One line for both empties, because the reader cannot
                     * act on the difference. `200 []` is a probed entry whose
                     * snapshot went with an `unavailable` verdict or aged out
                     * on the sample window; 404 is a handle nothing has ever
                     * stored Posts for. The failing case is folded in with
                     * them: the only error this route produces by design is
                     * that 404, and a section decorating a snapshot is not
                     * where a dead deployment should be reported.
                     */
                    <p
                      className="text-sm text-app-ink/50"
                      data-testid="discover-panel-posts-empty"
                    >
                      No sample posts stored for this Channel.
                    </p>
                  ) : (
                    posts.map((post) => (
                      <article
                        key={post.postId}
                        className="rounded-lg border border-app-ink/10 bg-app-muted/30 p-3"
                        data-testid={`discover-panel-post-${post.postId}`}
                      >
                        <div className="mb-1 flex items-center gap-2 text-xs text-app-ink/60">
                          <RelativeTime timestamp={post.timestamp} />
                          {/* `null` is *not measured*: Telegram stops
                           * rendering the counter on older Posts, which is
                           * the same absence the median has a threshold
                           * for. A zero here would be a claim. */}
                          {post.views != null ? (
                            <span className="tabular-nums">
                              {VIEWS.format(post.views)} views
                            </span>
                          ) : null}
                          <a
                            href={telegramWebViewPostUrl(
                              candidate.name,
                              post.postId,
                            )}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-auto inline-flex items-center gap-1 text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
                          >
                            <ExternalLink size={12} />
                            Open
                          </a>
                        </div>
                        {/* Clamped in CSS rather than truncated server-side.
                         * Four lines is enough to judge what a Channel
                         * writes about, and the whole body already travelled
                         * — so lifting the clamp later is a class, not a
                         * second route. "Open" is the full read. */}
                        <p
                          dir="auto"
                          className="line-clamp-4 whitespace-pre-wrap text-sm"
                        >
                          {post.text || "(no text)"}
                        </p>
                      </article>
                    ))
                  )}
                </div>
              </details>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
