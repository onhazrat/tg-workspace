import { useState } from "react"
import type { DirectoryDistributionResponse } from "@/client"
import { BoundFields } from "@/components/filter-tree/BoundFields"
import { TgButton } from "@/components/ui/tg-button"
import {
  type BoundKind,
  boundKind,
  type MetricBound,
  parseBound,
} from "@/lib/channels/channel-metrics"
import type { Measure } from "@/lib/directory/directory-filter"
import { formatCount } from "@/lib/format-count"

const DAY_PRESETS = [1, 7, 30, 90, 365]

/** Two significant figures, so a bar's edge reads 1,200 and not 1,187.43. */
const nice = (v: number) => Number(v.toPrecision(2))

type Bin = DirectoryDistributionResponse["bins"][number]

/** Whether a bar overlaps the bound, so the bars show what it keeps. */
const inside = (bin: Bin, bound: MetricBound | null) =>
  !!bound &&
  !bound.none &&
  (bound.min === undefined || bin.hi > bound.min) &&
  (bound.max === undefined || bin.lo <= bound.max)

function Spread({
  spread,
  bound,
  onBar,
}: {
  spread: DirectoryDistributionResponse
  bound: MetricBound | null
  onBar: (bin: Bin) => void
}) {
  const peak = Math.max(1, ...spread.bins.map((bin) => bin.count))
  return (
    <div className="space-y-1">
      <div className="flex h-16 items-end gap-px rounded-md bg-app-ink/[0.03] px-0.5">
        {spread.bins.map((bin, i) => (
          <button
            key={bin.lo}
            type="button"
            data-testid={`directory-bound-bar-${i}`}
            title={`${formatCount(bin.lo)}–${formatCount(bin.hi)}: ${bin.count} channels`}
            onClick={() => onBar(bin)}
            className={`flex-1 rounded-t-[2px] ${inside(bin, bound) ? "bg-app-ink/70" : "bg-app-ink/15 hover:bg-app-ink/40"}`}
            style={{
              height: `${bin.count === 0 ? 2 : Math.max(8, (bin.count / peak) * 100)}%`,
            }}
          />
        ))}
      </div>
      <div className="flex justify-between gap-2 text-[10px] tabular-nums text-app-ink/50">
        <span>{formatCount(spread.min ?? 0)}</span>
        <span>
          median {formatCount(spread.median ?? 0)}
          {spread.scale === "log" ? ", log scale" : ""}
        </span>
        <span>{formatCount(spread.max ?? 0)}</span>
      </div>
    </div>
  )
}

/**
 * One measure's bound in the Directory filter (DIR-02): its spread under
 * every other Condition, drawn by the server, a click on a bar setting the
 * bound, the four modes, day presets on a measure counted in days, and how
 * many Channels the bound leaves on Add. NOT is the chip's, not the editor's.
 *
 * `usePreviewCount` is the count read for a candidate bound, a hook the
 * container passes so this stays renderable without a server.
 */
export function DirectoryBoundEditor({
  measure,
  initial,
  distribution,
  usePreviewCount,
  onSubmit,
  onBack,
}: {
  measure: Measure
  /** The Condition being changed; without one the editor adds. */
  initial?: MetricBound
  distribution?: DirectoryDistributionResponse
  usePreviewCount: (bound: MetricBound | null) => number | undefined
  onSubmit: (bound: MetricBound) => void
  onBack?: () => void
}) {
  const [op, setOp] = useState<BoundKind>(
    initial ? boundKind(initial) : measure.days ? "lte" : "gte",
  )
  const [a, setA] = useState(
    String((op === "lte" ? initial?.max : initial?.min) ?? ""),
  )
  const [b, setB] = useState(String(initial?.max ?? ""))
  const bound = parseBound(op, a, b)
  const preview = usePreviewCount(bound)

  const onBar = (bin: Bin) => {
    const next = op === "none" ? "between" : op
    setOp(next)
    setA(String(nice(next === "lte" ? bin.hi : bin.lo)))
    setB(String(nice(bin.hi)))
  }
  const onPreset = (days: number) => {
    if (op !== "gte") setOp("lte")
    setA(String(days))
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
        <Spread spread={distribution} bound={bound} onBar={onBar} />
      ) : (
        <p className="text-[11px] text-app-ink/50">Loading the spread…</p>
      )}
      <BoundFields op={op} setOp={setOp} a={a} setA={setA} b={b} setB={setB} />
      {measure.days && op !== "none" && (
        <div className="flex gap-1">
          {DAY_PRESETS.map((days) => (
            <button
              key={days}
              type="button"
              aria-label={`${days} days`}
              onClick={() => onPreset(days)}
              className="rounded-full bg-app-ink/5 px-2 py-0.5 font-mono text-[11px] hover:bg-app-ink/10"
            >
              {days}d
            </button>
          ))}
        </div>
      )}
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
        {bound && preview !== undefined
          ? ` · ${preview.toLocaleString()} channels`
          : ""}
      </TgButton>
    </form>
  )
}
