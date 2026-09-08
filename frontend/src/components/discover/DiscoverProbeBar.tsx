import { Loader2 } from "lucide-react"
import type React from "react"

import type { DiscoverProbeQueue } from "@/api"
import { TgButton } from "@/components/ui/tg-button"

interface DiscoverProbeBarProps {
  queue: DiscoverProbeQueue
  /** `Permission.JOBS_MANAGE` — see `useCanManageJobs`. */
  canManageJobs: boolean
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
 * The whole bar hides only when there is nothing outstanding at all — unless
 * the reader may manage jobs, for which see below.
 *
 * ## Why an Operator keeps the bar when it is empty
 *
 * Ticket 04 hung the probe lane's Request spend off the same read, and a spend
 * total is the opposite kind of fact from a progress count: it is most worth
 * reading when nothing is running, because the question then is "what did the
 * sweep cost" rather than "is it moving". Hiding on an idle queue is still
 * exactly right for a bar reporting work in flight, so that condition survives
 * for every reader who only gets that bar.
 *
 * ## Why the spend and the pause control are gated
 *
 * The route authenticates its caller and asks nothing else, and that is not
 * this ticket's to change — the counts stay readable by anyone. What is gated
 * is the display. Spend is a fact about the deployment's budget, tolerable to
 * put in front of anyone only while it is transient progress on work they are
 * plausibly waiting for; permanent, it is no business of an ordinary account.
 *
 * The pause control rides the same gate, which fixes a bug older than the
 * ticket: `PUT /jobs/{id}` requires `JOBS_MANAGE` server-side, so an ordinary
 * account was being shown a button that answers 403. The bar's usual absence
 * is the only reason nobody hit it, and making the bar permanent would have
 * made that permanent too.
 */
export const DiscoverProbeBar: React.FC<DiscoverProbeBarProps> = ({
  queue,
  canManageJobs,
  onSetPaused,
  isPausePending,
}) => {
  const paused = !queue.enabled
  const draining = queue.queued > 0 || queue.running
  if (!draining && queue.retrying === 0 && !canManageJobs) return null

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
      {canManageJobs ? (
        <>
          <span className="text-app-ink/50">
            {queue.requestsToday.toLocaleString()} requests today ·{" "}
            {queue.requestsWeek.toLocaleString()} this week
          </span>
          <span className="text-app-ink/50">
            {!queue.harvestEnabled
              ? "Harvest off"
              : queue.harvestRunning
                ? "Harvest running"
                : "Harvest idle"}
          </span>
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
        </>
      ) : null}
    </div>
  )
}
