import { useMemo, useState } from "react"
import type { DirectoryDistributionResponse } from "@/client"
import { type Bin, Spread } from "@/components/directory/DirectoryBoundEditor"
import { dateText } from "@/components/directory/DirectoryTimeEditor"
import { type Range, useZoomState } from "@/components/SpreadZoom"
import { TimeBoundEditor } from "@/components/TimeBoundEditor"
import { TgButton } from "@/components/ui/tg-button"
import { floorToMinute, MINUTE_MS, serverNow } from "@/lib/analysis-window"
import type { TimeCond } from "@/lib/channels/channel-filter"
import type { MetricData } from "@/lib/channels/channel-metrics"
import {
  type ChannelMomentKey,
  channelMoment,
} from "@/lib/channels/channel-moments"
import {
  inTimeBound,
  minuteBound,
  resolveTimeBound,
  type TimeBound,
} from "@/lib/time-bound/bound"
import { BINS } from "./ChannelMetricEditor"

/** What a moment's Time bound turns on (ADR-033): all three switches. */
const OPTIONS = { openEnds: true, ahead: true }

/**
 * A moment's spread as the Directory's `Spread` draws it, binned here from
 * values the browser already has, over the zoom's `range` when there is one
 * (TB-04). Each value is floored to its minute first, so the Channels
 * sharing a minute share a bar, and each bar keeps the minutes it holds for
 * a click to bound.
 */
function spreadOf(sorted: number[], total: number, range: Range | null) {
  const minutes = sorted.map(floorToMinute)
  const [a, b] = range ?? [sorted[0], sorted[sorted.length - 1]]
  const lo = floorToMinute(a)
  const hi = floorToMinute(b) + MINUTE_MS
  const width = (hi - lo) / BINS
  const bars = Array.from({ length: BINS }, () => [] as number[])
  for (const m of minutes)
    if (m >= lo && m < hi)
      bars[Math.min(BINS - 1, Math.floor((m - lo) / width))].push(m)
  const spread: DirectoryDistributionResponse = {
    scale: "linear",
    total,
    noValue: total - sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median: sorted[Math.floor(sorted.length / 2)],
    bins: bars.map((bar, i) => ({
      lo: lo + i * width,
      hi: lo + (i + 1) * width,
      count: bar.length,
    })),
  }
  return { spread, bars }
}

/**
 * The spread a moment's editor draws (TB-03). A click on a bar sets a Fixed
 * bound over the minutes it holds, its End one minute past the newest, so
 * the bound keeps exactly the Channels the bar counts.
 */
function MomentSpread({
  values,
  total,
  bound,
  onPick,
}: {
  values: number[]
  total: number
  bound: TimeBound | null
  onPick: (bound: TimeBound) => void
}) {
  const zoom = useZoomState()
  const { spread, bars } = useMemo(
    () => spreadOf(values, total, zoom.range),
    [values, total, zoom.range],
  )
  const { start, end } = bound
    ? resolveTimeBound(bound, floorToMinute(serverNow()))
    : {}
  const onBar = (bin: Bin) => {
    const minutes = bars[spread.bins.indexOf(bin)]
    if (!minutes.length) return
    onPick(minuteBound(minutes[0], minutes[minutes.length - 1]))
  }
  return (
    <Spread
      spread={spread}
      bound={
        bound && {
          ...(start !== undefined && { min: start }),
          ...(end !== undefined && { max: end }),
        }
      }
      onBar={onBar}
      format={dateText}
      zoom={zoom}
    />
  )
}

/** The Condition Add would apply; `null` while the bound is Any time. */
function condition(
  moment: ChannelMomentKey,
  bound: TimeBound,
  none: boolean,
): TimeCond | null {
  if (none) return { type: "time", moment, mode: bound.mode, none: true }
  if (bound.start === undefined && bound.end === undefined) return null
  return { type: "time", moment, ...bound }
}

/**
 * A Time bound on one of a Channel's moments (TB-03): its name and spread,
 * the Analysis window editor with open ends, an End ahead of now and No
 * value, and Add or Update with how many Channels it keeps. NOT is the
 * chip's, not the editor's.
 */
export function ChannelTimeEditor({
  momentKey,
  data,
  initial,
  onSubmit,
  onBack,
}: {
  momentKey: ChannelMomentKey
  data: MetricData
  /** The Condition being changed; without one the editor adds. */
  initial?: TimeCond
  onSubmit: (cond: TimeCond) => void
  onBack?: () => void
}) {
  const m = channelMoment(momentKey)
  const values = useMemo(() => data.moments(momentKey), [data, momentKey])
  const [bound, setBound] = useState<TimeBound>(() => ({
    mode: initial?.mode ?? "live",
    ...(initial?.start !== undefined && { start: initial.start }),
    ...(initial?.end !== undefined && { end: initial.end }),
  }))
  const [none, setNone] = useState(!!initial?.none)
  const cond = condition(momentKey, bound, none)
  const at = floorToMinute(serverNow())
  const kept = none
    ? data.total - values.length
    : values.filter((v) => inTimeBound(v, bound, at)).length
  return (
    <form
      className="space-y-2 p-1"
      onSubmit={(e) => {
        e.preventDefault()
        if (cond) onSubmit(cond)
      }}
    >
      <div className="flex items-center gap-2 text-xs font-semibold">
        {onBack && (
          <button
            type="button"
            aria-label="Back to the criteria"
            onClick={onBack}
            className="text-app-ink/50 hover:text-app-ink"
          >
            ←
          </button>
        )}
        {m.label}
      </div>
      <p className="text-[11px] text-app-ink/50">{m.description}</p>
      {values.length > 0 ? (
        <MomentSpread
          values={values}
          total={data.total}
          bound={cond && !none ? bound : null}
          onPick={(next) => {
            setNone(false)
            setBound(next)
          }}
        />
      ) : (
        <p className="text-[11px] text-app-ink/50">
          None of your channels has a value yet.
        </p>
      )}
      <TimeBoundEditor
        value={bound}
        onChange={setBound}
        opts={OPTIONS}
        modeLabel={`${m.label} mode`}
        noValue={{ on: none, onChange: setNone }}
      />
      <TgButton
        type="submit"
        size="sm"
        disabled={!cond}
        data-testid="channel-time-submit"
        className="w-full"
      >
        {initial ? "Update" : "Add"} ·{" "}
        {none
          ? `${kept} with no value`
          : `${kept} of ${values.length} with a value`}
      </TgButton>
    </form>
  )
}
