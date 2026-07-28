import { useQuery } from "@tanstack/react-query"
import { ExternalLink, Plus } from "lucide-react"
import type React from "react"
import { api } from "@/api"
import { RelativeTime } from "@/components/RelativeTime"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { TgButton } from "@/components/ui/tg-button"
import {
  DISCOVERY_SIGNAL_KINDS,
  DISCOVERY_SIGNAL_LABELS,
  type DiscoveryCandidate,
} from "@/lib/posts/discover-candidates"
import {
  telegramWebViewChannelUrl,
  telegramWebViewPostUrl,
} from "@/lib/telegram-web"

interface DiscoverCandidatePanelProps {
  candidate: DiscoveryCandidate | null
  onClose: () => void
  isOffline: boolean
  isFollowJobRunning: boolean
  onFollow: (name: string) => void
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
  isOffline,
  isFollowJobRunning,
  onFollow,
}) => {
  const sample = candidate?.samplePost ?? null

  // Fetched lazily rather than stored in the report: only the pointer is
  // persisted, so a report stays small and never carries a stale copy of a post
  // that has since been edited.
  const sampleQuery = useQuery({
    queryKey: [
      "discoverSamplePost",
      sample?.channelName ?? "",
      sample?.postId ?? 0,
    ],
    queryFn: () =>
      api.lookupPosts([
        { channelName: sample!.channelName, postId: sample!.postId },
      ]),
    enabled: Boolean(sample),
  })

  const post = sampleQuery.data?.[0] ?? null
  // Retention prunes posts; a saved report outlives them by design. Absence is
  // an expected state, not an error — the Telegram link below still works.
  const samplePruned = Boolean(
    sample && !sampleQuery.isLoading && !sampleQuery.isError && !post,
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
              <SheetDescription>
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
                {sample ? (
                  <div className="space-y-2">
                    <p className="text-xs text-app-ink/60">
                      in{" "}
                      <span className="font-mono">@{sample.channelName}</span> ·{" "}
                      <RelativeTime timestamp={sample.timestamp} />
                    </p>
                    {sampleQuery.isLoading ? (
                      <p className="text-sm text-app-ink/50">Loading post…</p>
                    ) : post?.text ? (
                      <blockquote
                        className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-app-ink/10 bg-app-muted/30 p-3 text-sm"
                        data-testid="discover-panel-sample-text"
                      >
                        {post.text}
                      </blockquote>
                    ) : (
                      <p
                        className="text-sm text-app-ink/50"
                        data-testid="discover-panel-sample-missing"
                      >
                        {samplePruned
                          ? "This post is no longer in your corpus. Open it on Telegram to read it."
                          : "Post text unavailable."}
                      </p>
                    )}
                    <a
                      href={telegramWebViewPostUrl(
                        sample.channelName,
                        sample.postId,
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="discover-panel-sample-link"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
                    >
                      <ExternalLink size={12} />
                      View this post on Telegram
                    </a>
                  </div>
                ) : (
                  <p className="text-sm text-app-ink/50">
                    No sample post recorded.
                  </p>
                )}
              </section>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
