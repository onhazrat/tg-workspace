import { type ReactNode, useState } from "react"
import type { DirectoryDistributionResponse } from "@/client"
import { type Bin, dateText, Spread } from "@/components/Spread"
import { useZoomState, type ZoomState } from "@/components/SpreadZoom"
import { TimeSpread } from "@/components/spread-prototype/TimeSpread"
import { useSpreadVariant } from "@/components/spread-prototype/variant"
import { TimeBoundEditor } from "@/components/TimeBoundEditor"
import { TgButton } from "@/components/ui/tg-button"
import { serverNow } from "@/lib/analysis-window"
import type {
  DirectoryTimeCond,
  Moment,
} from "@/lib/directory/directory-filter"
import {
  barBound,
  MOMENT_OPTIONS,
  resolveTimeBound,
  type TimeBound,
} from "@/lib/time-bound/bound"

/** The Condition Add would apply; `null` while the bound is Any time. */
function condition(
  moment: Moment,
  bound: TimeBound,
  none: boolean,
): DirectoryTimeCond | null {
  if (none)
    return { type: "time", moment: moment.key, mode: bound.mode, none: true }
  if (bound.start === undefined && bound.end === undefined) return null
  return { type: "time", moment: moment.key, ...bound }
}

/**
 * A Time bound in the Directory filter (DPF, TB-01): the moment's name and
 * spread, the Analysis window editor with open ends, an End ahead of now and
 * No value, and Add or Update with the count it keeps. The spread is drawn by
 * the server in epoch ms, and a click on a bar sets a Fixed bound over it,
 * out to whole minutes.
 * NOT is the chip's, not the editor's.
 */
export function DirectoryTimeEditor({
  moment,
  initial,
  distribution,
  countFor,
  onSubmit,
  onBack,
  zoom,
}: {
  moment: Moment
  /** The Condition being changed; without one the editor adds. */
  initial?: DirectoryTimeCond
  distribution?: DirectoryDistributionResponse
  /** The range `distribution` was asked for; the container keeps it (TB-04). */
  zoom?: ZoomState
  countFor: (cond: DirectoryTimeCond) => ReactNode
  onSubmit: (cond: DirectoryTimeCond) => void
  onBack?: () => void
}) {
  const [bound, setBound] = useState<TimeBound>(() => ({
    mode: initial?.mode ?? "live",
    ...(initial?.start !== undefined && { start: initial.start }),
    ...(initial?.end !== undefined && { end: initial.end }),
  }))
  const [none, setNone] = useState(!!initial?.none)
  // PROTOTYPE: variant 1 draws the one Spread.
  const variant = useSpreadVariant()
  const ownZoom = useZoomState()
  const cond = condition(moment, bound, none)
  // The bars are in epoch ms, so a Live end is placed against now.
  const { start, end } = resolveTimeBound(bound, serverNow())
  const highlight = cond &&
    !none && {
      ...(start !== undefined && { min: start }),
      ...(end !== undefined && { max: end }),
    }

  const onBar = (bin: Bin) => {
    setNone(false)
    setBound(barBound(bin, bin === distribution?.bins.at(-1)))
  }
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
        {moment.label}
      </div>
      <p className="text-[11px] text-app-ink/50">{moment.description}</p>
      {distribution && variant === "1" ? (
        <TimeSpread
          spread={distribution}
          zoom={zoom ?? ownZoom}
          selected={highlight || null}
          onPick={(next) => {
            setNone(false)
            setBound(next)
          }}
          title={moment.label}
        />
      ) : distribution ? (
        <Spread
          spread={distribution}
          bound={highlight || null}
          onBar={onBar}
          format={dateText}
          zoom={zoom}
        />
      ) : (
        <p className="text-[11px] text-app-ink/50">Loading the spread…</p>
      )}
      <TimeBoundEditor
        value={bound}
        onChange={setBound}
        opts={MOMENT_OPTIONS}
        modeLabel={`${moment.label} mode`}
        noValue={{ on: none, onChange: setNone }}
      />
      {!!distribution?.noValue && (
        <p className="text-[11px] text-app-ink/50">
          {distribution.noValue.toLocaleString()} have no value and fail every
          bound. No value finds exactly those.
        </p>
      )}
      <TgButton
        type="submit"
        size="sm"
        disabled={!cond}
        data-testid="directory-time-submit"
        className="w-full"
      >
        {initial ? "Update" : "Add"}
        {cond && countFor(cond)}
      </TgButton>
    </form>
  )
}
