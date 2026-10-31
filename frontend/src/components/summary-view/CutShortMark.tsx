import { RotateCcw, Scissors } from "lucide-react"
import type { ReactNode } from "react"
import type { SummaryAttemptResponse } from "@/client"
import { TgButton } from "@/components/ui/tg-button"
import { RunningAttemptCard } from "./FailedSummaryPanel"

/** The mark with its retry: `attempt` is the one running, if any. */
export function CutShortRetry({
  attempt,
  text,
  keyLabel,
  onRetry,
  onStop,
}: {
  attempt: SummaryAttemptResponse | undefined
  text: string
  keyLabel: (keyId: string | null) => string | undefined
  onRetry: () => void
  onStop: (attemptId: string) => void
}) {
  return (
    <CutShortMark
      onRetry={onRetry}
      running={
        attempt && (
          <RunningAttemptCard
            attempt={attempt}
            text={text}
            keyLabel={keyLabel}
            onStop={() => onStop(attempt.id)}
          />
        )
      }
    />
  )
}

/**
 * The end of a Cut short Summary's text (SFR-03): it is a kept Partial
 * response, so the reader is told where it stops, and it can still be
 * retried. `running` is the retry under way, shown in the button's place.
 */
export function CutShortMark({
  onRetry,
  running,
}: {
  onRetry: () => void
  running: ReactNode
}) {
  return (
    <section
      data-testid="cut-short-mark"
      className="mt-6 space-y-3 border-t border-dashed border-amber-500/60 pt-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-amber-900 dark:text-amber-100">
          <Scissors size={14} className="shrink-0" />
          Cut short. The text stops here: it is what an Attempt wrote before it
          was cut off.
        </p>
        {!running && (
          <TgButton type="button" variant="secondary" onClick={onRetry}>
            <RotateCcw size={14} />
            Retry
          </TgButton>
        )}
      </div>
      {running}
    </section>
  )
}
