import { Loader2 } from "lucide-react"
import type React from "react"

import type { DiscoverProbeJob } from "@/api"
import { TgButton } from "@/components/ui/tg-button"

interface DiscoverProbeBarProps {
  job: DiscoverProbeJob
  onCancel: () => void
}

/**
 * Progress of the background sweep that resolves what each handle is (D9).
 *
 * Shown only while a sweep is running. It is deliberately unobtrusive: the
 * sweep is not something the operator asked for, the report is fully usable
 * while it runs, and rows resolve underneath it as verdicts land.
 *
 * A cancel is offered because the sweep competes with scraping for the same
 * proxy lanes — someone who cares more about a sync finishing should be able to
 * stand it down without waiting.
 */
export const DiscoverProbeBar: React.FC<DiscoverProbeBarProps> = ({
  job,
  onCancel,
}) => (
  <div
    className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-app-ink/10 bg-app-muted/30 px-3 py-2 text-xs text-app-ink/70"
    data-testid="discover-probe-bar"
  >
    <Loader2 size={13} className="animate-spin opacity-60" />
    <span>
      Checking handles… {job.completed}/{job.total}
    </span>
    {job.unavailable > 0 ? (
      <span className="text-app-ink/50">
        {job.unavailable} not followable so far
      </span>
    ) : null}
    <TgButton
      type="button"
      variant="secondary"
      size="sm"
      data-testid="discover-probe-cancel"
      onClick={onCancel}
      className="rounded-full text-app-ink/60"
    >
      Stop
    </TgButton>
  </div>
)
