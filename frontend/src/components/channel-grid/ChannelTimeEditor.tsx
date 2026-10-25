import { useMemo, useState } from "react"
import { dateText, Spread } from "@/components/Spread"
import { useRangeZoomKit, useZoomState } from "@/components/SpreadZoom"
import { TimeBoundEditor } from "@/components/TimeBoundEditor"
import { TgButton } from "@/components/ui/tg-button"
import { floorToMinute, MINUTE_MS, serverNow } from "@/lib/analysis-window"
import type { TimeCond } from "@/lib/channels/channel-filter"
import type { MetricData } from "@/lib/channels/channel-metrics"
import {
  type ChannelMomentKey,
  channelMoment,
} from "@/lib/channels/channel-moments"
import { binSpread } from "@/lib/spread"
import {
  inTimeBound,
  MOMENT_OPTIONS,
  pickedBound,
  spreadSelection,
  type TimeBound,
} from "@/lib/time-bound/bound"

/**
 * The spread a moment's editor draws (TB-03), binned here by minute from
 * values the browser already has, over the zoom's range (TB-04). A pick sets
 * a Fixed bound over the minutes its bars hold, its End one minute past the
 * newest, so the bound keeps exactly the Channels the bars count.
 */
function MomentSpread({
  values,
  bound,
  onPick,
  title,
}: {
  values: number[]
  bound: TimeBound | null
  onPick: (bound: TimeBound) => void
  title: string
}) {
  const zoom = useZoomState()
  const d = useMemo(
    () => binSpread(values, zoom.range, { moments: true }),
    [values, zoom.range],
  )
  const selected = bound && spreadSelection(bound, floorToMinute(serverNow()))
  const kit = useRangeZoomKit(zoom, { ...d, bound: selected })
  return (
    <Spread
      bars={d.bars}
      whole={[d.lo, d.hi]}
      shown={zoom.range ?? [d.lo, d.hi]}
      median={d.median}
      selected={selected}
      onPick={(p) => {
        const held = values.filter((v) => {
          const i = d.barOf(v)
          return i !== null && i >= p.run.from && i <= p.run.to
        })
        if (!held.length) return
        const newest = floorToMinute(held[held.length - 1]) + MINUTE_MS
        onPick(pickedBound(p, floorToMinute(held[0]), newest))
      }}
      format={dateText}
      noun="channels"
      zoom={kit}
      title={title}
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
            aria-label="Back to the conditions"
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
          title={m.label}
          values={values}
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
        opts={MOMENT_OPTIONS}
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
