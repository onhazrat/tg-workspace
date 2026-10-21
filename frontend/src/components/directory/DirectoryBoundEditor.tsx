import { type ReactNode, useState } from "react"
import type { DirectoryDistributionResponse } from "@/client"
import { BoundFields } from "@/components/filter-tree/BoundFields"
import { type Bin, Spread } from "@/components/Spread"
import type { ZoomState } from "@/components/SpreadZoom"
import { TgButton } from "@/components/ui/tg-button"
import {
  type BoundKind,
  boundKind,
  type MetricBound,
  parseBound,
} from "@/lib/channels/channel-metrics"
import type { Measure } from "@/lib/directory/directory-filter"

/** Two significant figures, so a bar's edge reads 1,200 and not 1,187.43. */
const nice = (v: number) => Number(v.toPrecision(2))

/**
 * One measure's bound in the Directory filter (DIR-02): its spread under
 * every other Condition, drawn by the server, a click on a bar setting the
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

  const onBar = (bin: Bin) => {
    const next = op === "none" ? "between" : op
    setOp(next)
    setA(String(nice(next === "lte" ? bin.hi : bin.lo)))
    setB(String(nice(bin.hi)))
  }

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
      {distribution ? (
        <Spread spread={distribution} bound={bound} onBar={onBar} zoom={zoom} />
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
