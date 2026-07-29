import { Loader2 } from "lucide-react"
import type React from "react"

import type { DiscoverProbeQueue } from "@/api"
import { TgButton } from "@/components/ui/tg-button"

interface DiscoverProbeBarProps {
  queue: DiscoverProbeQueue
  onSetPaused: (paused: boolean) => void
  isPausePending: boolean
}

/**
 * How much handle-probing is still outstanding (D9).
 *
 * Deliberately unobtrusive: probing is not something the operator asked for, the
 * report is fully usable while it happens, and rows resolve underneath this as
 * verdicts land.
 *
 * ## Why the counts are split
 *
 * `queued` drains to zero, so it is the one that can read as progress. `retrying`
 * may never reach zero — an unreachable handle keeps retrying at the backoff
 * ceiling by design — so it is reported separately and never gates the spinner.
 * On a healthy install that line is absent, which makes its presence a real
 * signal that something is wrong with the proxy pool rather than noise.
 *
 * The whole bar hides only when there is nothing outstanding at all.
 */
export const DiscoverProbeBar: React.FC<DiscoverProbeBarProps> = ({
  queue,
  onSetPaused,
  isPausePending,
}) => {
  const paused = !queue.enabled
  const draining = queue.queued > 0 || queue.running
  if (!draining && queue.retrying === 0) return null

  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-app-ink/10 bg-app-muted/30 px-3 py-2 text-xs text-app-ink/70"
      data-testid="discover-probe-bar"
    >
      {draining && !paused ? (
        <>
          <Loader2 size={13} className="animate-spin opacity-60" />
          <span>Checking handles… {queue.queued} left</span>
        </>
      ) : null}
      {draining && paused ? (
        <span>Handle checks paused — {queue.queued} left</span>
      ) : null}
      {queue.unavailable > 0 ? (
        <span className="text-app-ink/50">
          {queue.unavailable} not followable so far
        </span>
      ) : null}
      {queue.retrying > 0 ? (
        <span className="text-app-ink/50">
          {queue.retrying} failing, will retry
        </span>
      ) : null}
      {draining ? (
        <TgButton
          type="button"
          variant="secondary"
          size="sm"
          data-testid="discover-probe-pause"
          disabled={isPausePending}
          onClick={() => onSetPaused(!paused)}
          className="rounded-full text-app-ink/60"
        >
          {paused ? "Resume" : "Pause"}
        </TgButton>
      ) : null}
    </div>
  )
}
