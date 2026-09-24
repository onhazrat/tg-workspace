import { useQuery } from "@tanstack/react-query"
import { ExternalLink } from "lucide-react"
import type React from "react"
import { useState } from "react"
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
import { queryKeys } from "@/hooks/queryKeys"
import type { DiscoveryCandidate } from "@/lib/posts/discover-candidates"
import { renderPostText } from "@/lib/posts/render-post-text"
import {
  telegramWebViewChannelUrl,
  telegramWebViewPostUrl,
} from "@/lib/telegram-web"
import type { Post } from "@/types"
import {
  ChannelStatistics,
  FollowControl,
  PANEL_LINK_CLASS,
  RecentPosts,
  referenceView,
  SeenBy,
  SignalCounts,
} from "./DiscoverPanelSections"

/** Compact, the way the row's median views are formatted. */
interface DiscoverCandidatePanelProps {
  candidate: DiscoveryCandidate | null
  onClose: () => void
  isOffline: boolean
  activeFollowNames: string[]
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
  ...actions
}) => (
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
      {/* Keyed by handle: a sheet that stays mounted between Candidates would
       * otherwise open the next one already expanded, onto the previous
       * handle's Posts while the new ones load. */}
      {candidate && (
        <CandidateDetails
          key={candidate.name}
          candidate={candidate}
          {...actions}
        />
      )}
    </SheetContent>
  </Sheet>
)

function CandidateDetails({
  candidate,
  isOffline,
  activeFollowNames,
  onFollow,
  onRecheck,
  isRecheckPending,
}: Omit<DiscoverCandidatePanelProps, "candidate" | "onClose"> & {
  candidate: DiscoveryCandidate
}) {
  const reference = candidate.reference ?? null

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
    queryKey: queryKeys.directoryPosts(candidate.name),
    queryFn: () => dataGetDirectoryPosts({ path: { handle: candidate.name } }),
    enabled: postsOpen,
    retry: false,
  })

  const referencePost = useReferencePost(reference)

  return (
    <>
      <SheetHeader>
        <SheetTitle className="font-mono">@{candidate.name}</SheetTitle>
        {/* dir="auto" for the same reason as in the table: a Persian display
         * name renders its own punctuation on the wrong side when it inherits
         * the page's LTR direction. */}
        <SheetDescription dir="auto">
          {candidate.displayName ?? "Referenced by your channels"}
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-5 px-4 pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <FollowControl
            name={candidate.name}
            isFollowed={candidate.isFollowed}
            disabled={isOffline}
            following={activeFollowNames.includes(candidate.name)}
            onFollow={() => onFollow(candidate.name)}
          />
          <a
            href={telegramWebViewChannelUrl(candidate.name)}
            target="_blank"
            rel="noopener noreferrer"
            className={PANEL_LINK_CLASS}
          >
            <ExternalLink size={12} />
            Open on Telegram
          </a>
        </div>

        <ChannelStatistics
          candidate={candidate}
          recheckDisabled={isOffline || isRecheckPending}
          onRecheck={() => onRecheck(candidate.name)}
        />
        <SignalCounts candidate={candidate} />
        <SeenBy candidate={candidate} />
        <ReferenceSection reference={reference} {...referencePost} />

        {/*
         * The Channel's own Posts, last and behind a disclosure.
         *
         * Last because the Reference — the Post in a Channel you follow that
         * named this handle — is why the Candidate is on the report at all, and
         * these never displace it. Behind a disclosure because twenty bodies
         * open by default is a wall of text in front of the statistics
         * somebody opened the panel to read.
         *
         * A native `<details>`: it is a disclosure, the platform has one, and it
         * keeps its keyboard and screen-reader behaviour without a line of ours.
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
            <RecentPosts
              handle={candidate.name}
              loading={postsQuery.isLoading}
              posts={postsQuery.data ?? []}
            />
          </div>
        </details>
      </div>
    </>
  )
}

/**
 * The post in a followed Channel that named this handle — why the Candidate is
 * on the report at all.
 *
 * Kept in this file rather than beside the other sections because
 * `bidi-invariants.test.ts` reads this file for the quote's `dir="auto"`.
 */
export function ReferenceSection({
  reference,
  loading,
  failed,
  post,
}: {
  reference: DiscoveryCandidate["reference"] | null
  loading: boolean
  failed: boolean
  post: Post | null
}) {
  const view = referenceView({
    hasReference: reference !== null,
    loading,
    failed,
    found: post !== null,
    text: post?.text,
  })
  return (
    <section>
      <h4 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-app-ink/50">
        Most recent reference
      </h4>
      {reference === null ? (
        <p className="text-sm text-app-ink/50">No reference recorded.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-app-ink/60">
            in <span className="font-mono">@{reference.channelName}</span> ·{" "}
            <RelativeTime timestamp={reference.timestamp} />
          </p>
          {view === "loading" && (
            <p className="text-sm text-app-ink/50">Loading post…</p>
          )}
          {view === "text" && post && (
            <blockquote
              dir="auto"
              className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-app-ink/10 bg-app-muted/30 p-3 text-sm"
              data-testid="discover-panel-reference-text"
            >
              {renderPostText(post.text, "", post.linkSpans)}
            </blockquote>
          )}
          {(view === "pruned" || view === "unavailable") && (
            <p
              className="text-sm text-app-ink/50"
              data-testid="discover-panel-reference-missing"
            >
              {view === "pruned"
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
            className={PANEL_LINK_CLASS}
          >
            <ExternalLink size={12} />
            View this post on Telegram
          </a>
        </div>
      )}
    </section>
  )
}

/**
 * The referencing post's body, fetched lazily rather than stored in the report:
 * only the pointer is persisted, so a report stays small and never carries a
 * stale copy of a post that has since been edited.
 */
function useReferencePost(reference: DiscoveryCandidate["reference"] | null) {
  const query = useQuery({
    queryKey: [
      "discoverReferencePost",
      reference?.channelName ?? "",
      reference?.postId ?? 0,
    ],
    queryFn: () =>
      api.lookupPosts([
        { channelName: reference!.channelName, postId: reference!.postId },
      ]),
    enabled: reference !== null,
  })
  return {
    loading: query.isLoading,
    failed: query.isError,
    post: query.data?.[0] ?? null,
  }
}
