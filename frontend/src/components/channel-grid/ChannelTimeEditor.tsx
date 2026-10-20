/**
 * PROTOTYPE (time-bound): a Time bound on a Channel moment, in the Posts
 * tab's Analysis window editor. Throwaway: fold the winner in, delete this.
 */
import { useMemo, useState } from "react"
import type { DirectoryDistributionResponse } from "@/client"
import { Spread } from "@/components/directory/DirectoryBoundEditor"
import {
  inTimeBound,
  resolveTimeBound,
  type TimeBound,
  TimeBoundEditor,
} from "@/components/time-bound-prototype/TimeBoundEditor"
import { momentText, type Range } from "@/components/time-bound-prototype/zoom"
import { TgButton } from "@/components/ui/tg-button"
import type { TimeCond } from "@/lib/channels/channel-filter"
import { channelMoment } from "@/lib/channels/channel-moments"
import type { Channel } from "@/types"

const BINS = 32
const MINUTE = 60_000

/**
 * The Directory's spread, drawn here from values the browser already has:
 * `min`/`max` the whole spread, the bars over `range` when zoomed.
 */
function spreadOf(
  sorted: number[],
  total: number,
  range: Range | null,
): DirectoryDistributionResponse {
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  const [lo, hi] = range ?? [min, max]
  const width = (hi - lo) / BINS
  const counts = new Array<number>(BINS).fill(0)
  for (const v of sorted) {
    if (v < lo || v > hi || width <= 0) continue
    counts[Math.min(BINS - 1, Math.floor((v - lo) / width))]++
  }
  return {
    scale: "linear",
    total,
    noValue: total - sorted.length,
    min,
    max,
    median: sorted[Math.floor(sorted.length / 2)],
    bins:
      width > 0
        ? counts.map((count, i) => ({
            lo: lo + i * width,
            hi: lo + (i + 1) * width,
            count,
          }))
        : [],
  }
}

export function ChannelTimeEditor({
  momentKey,
  channels,
  initial,
  onSubmit,
  onBack,
}: {
  momentKey: TimeCond["moment"]
  channels: Channel[]
  initial?: TimeCond
  onSubmit: (cond: TimeCond) => void
  onBack?: () => void
}) {
  const m = channelMoment(momentKey)
  const [bound, setBound] = useState<TimeBound>(() => ({
    mode: initial?.mode ?? "live",
    ...(!initial?.none && { start: initial?.start, end: initial?.end }),
  }))
  const [none, setNone] = useState(!!initial?.none)
  const values = channels.map((c) => m.value(c) ?? undefined)
  const measured = values.filter((v): v is number => v !== undefined)
  const sorted = useMemo(() => [...measured].sort((a, b) => a - b), [measured])
  const [range, setRange] = useState<Range | null>(null)
  const { start: at0, end: at1 } = resolveTimeBound(bound)
  const open = bound.start === undefined && bound.end === undefined
  const cond: TimeCond | null = none
    ? { type: "time", moment: m.key, mode: "fixed", none: true }
    : open
      ? null
      : {
          type: "time",
          moment: m.key,
          mode: bound.mode,
          ...(bound.start !== undefined && { start: bound.start }),
          ...(bound.end !== undefined && { end: bound.end }),
        }
  const kept = none
    ? values.length - measured.length
    : measured.filter((v) => inTimeBound(v, bound)).length
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
      {sorted.length > 1 ? (
        <Spread
          spread={spreadOf(sorted, values.length, range)}
          bound={
            none || open
              ? null
              : {
                  ...(at0 !== undefined && { min: at0 }),
                  ...(at1 !== undefined && { max: at1 }),
                }
          }
          onBar={(bin) => {
            setNone(false)
            // Out to whole minutes, the End past the bar's last value: the
            // bound excludes its End, and the newest bar holds the newest.
            setBound({
              mode: "fixed",
              start: Math.floor(bin.lo / MINUTE) * MINUTE,
              end: Math.floor(bin.hi / MINUTE) * MINUTE + MINUTE,
            })
          }}
          format={momentText(range)}
          zoom={{ range, setRange }}
        />
      ) : (
        <p className="text-[11px] text-app-ink/50">
          None of your channels has a value yet.
        </p>
      )}
      <TimeBoundEditor
        value={bound}
        onChange={setBound}
        opts={{ openEnds: true, ahead: true }}
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
          : `${kept} of ${measured.length} with a value`}
      </TgButton>
    </form>
  )
}
