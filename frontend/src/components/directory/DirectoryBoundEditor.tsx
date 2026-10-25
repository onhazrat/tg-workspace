import { type ReactNode, useState } from "react"
import type { DirectoryDistributionResponse } from "@/client"
import { BoundFields } from "@/components/filter-tree/BoundFields"
import { NumberSpread } from "@/components/filter-tree/NumberSpread"
import {
  SETTLE_MS,
  useZoomState,
  type ZoomState,
} from "@/components/SpreadZoom"
import { TgButton } from "@/components/ui/tg-button"
import {
  type BoundKind,
  boundKind,
  type MetricBound,
  parseBound,
} from "@/lib/channels/channel-metrics"
import type { Measure } from "@/lib/directory/directory-filter"

/**
 * One measure's bound in the Directory filter (DIR-02): its spread under
 * every other Condition, drawn by the server, a pick on it setting the
 * bound, the four modes, and how many Channels the bound leaves on Add. NOT
 * is the chip's, not the editor's.
 *
 * `countFor` renders how many a candidate bound leaves; the container passes
 * an element that reads it, so this stays renderable without a server.
 */
export function DirectoryBoundEditor({
  measure,
  initial,
  distribution,
  countFor,
  onSubmit,
  onBack,
  zoom,
}: {
  measure: Measure
  /** The Condition being changed; without one the editor adds. */
  initial?: MetricBound
  distribution?: DirectoryDistributionResponse
  /** The range `distribution` was asked for; the container keeps it (TB-04). */
  zoom?: ZoomState
  countFor: (bound: MetricBound) => ReactNode
  onSubmit: (bound: MetricBound) => void
  onBack?: () => void
}) {
  const [op, setOp] = useState<BoundKind>(initial ? boundKind(initial) : "gte")
  const [a, setA] = useState(
    String((op === "lte" ? initial?.max : initial?.min) ?? ""),
  )
  const [b, setB] = useState(String(initial?.max ?? ""))
  const bound = parseBound(op, a, b)

  const own = useZoomState()
  const select = (next: MetricBound) => {
    setOp(boundKind(next))
    setA(String(next.min ?? next.max))
    setB(String(next.max ?? ""))
  }
  const d = distribution

  return (
    <form
      className="space-y-2 p-1"
      onSubmit={(e) => {
        e.preventDefault()
        if (bound) onSubmit(bound)
      }}
    >
      <div className="flex items-center gap-2 text-xs font-semibold">
        {onBack && (
          <button
            type="button"
            aria-label="Back to the conditions"
            onClick={onBack}
            className="text-app-ink/50 hover:text-app-ink"
          >
            ←
          </button>
        )}
        {measure.label}
      </div>
      <p className="text-[11px] text-app-ink/50">{measure.description}</p>
      {d && d.min !== null && d.max !== null ? (
        <NumberSpread
          bars={{
            bars: d.bins,
            lo: d.min,
            hi: d.max,
            median: d.median ?? d.min,
            log: d.scale === "log",
          }}
          zoom={zoom ?? own}
          bound={bound}
          onPick={select}
          noun="channels"
          title={measure.label}
          settle={SETTLE_MS}
        />
      ) : d ? (
        <p className="text-[11px] text-app-ink/50">Nothing has a value yet.</p>
      ) : (
        <p className="text-[11px] text-app-ink/50">Loading the spread…</p>
      )}
      <BoundFields op={op} setOp={setOp} a={a} setA={setA} b={b} setB={setB} />
      {!!distribution?.noValue && (
        <p className="text-[11px] text-app-ink/50">
          {distribution.noValue.toLocaleString()} have no value and fail every
          bound. No value finds exactly those.
        </p>
      )}
      <TgButton
        type="submit"
        size="sm"
        disabled={!bound}
        data-testid="directory-bound-submit"
        className="w-full"
      >
        {initial ? "Update" : "Add"}
        {bound && countFor(bound)}
      </TgButton>
    </form>
  )
}
