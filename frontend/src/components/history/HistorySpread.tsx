/**
 * The time filter's spread (HTR): when Artifacts were Written, or their
 * windows started, drawn in its popover as the Logs tab draws its Logged
 * spread. Under every History filter but the bound, so it shows what lies
 * around the range chosen; a bar sets a Fixed bound on it.
 */

import { LoggedSpreadView } from "@/components/logs/LoggedSpread"
import { useZoomState } from "@/components/SpreadZoom"
import { useArtifactSpread } from "@/hooks/useArtifacts"
import type { HistoryParams } from "@/lib/history/history-params"
import type { TimeBound } from "@/lib/time-bound/bound"

export function HistorySpread({
  params,
  onPick,
}: {
  params: HistoryParams
  onPick: (bound: TimeBound) => void
}) {
  const zoom = useZoomState()
  const spread = useArtifactSpread(params, zoom.range)
  return (
    <LoggedSpreadView
      spread={spread.data}
      bound={params.bound}
      zoom={zoom}
      onPick={onPick}
      noun={params.moment === "window" ? "window starts" : "artifacts"}
    />
  )
}
