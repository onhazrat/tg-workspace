/**
 * PROTOTYPE (time-bound): a Time bound on a Channel moment, in the Posts
 * tab's Analysis window editor. Throwaway: fold the winner in, delete this.
 */
import { useState } from "react"
import {
  inTimeBound,
  type TimeBound,
  TimeBoundEditor,
} from "@/components/time-bound-prototype/TimeBoundEditor"
import { TgButton } from "@/components/ui/tg-button"
import type { TimeCond } from "@/lib/channels/channel-filter"
import { channelMoment } from "@/lib/channels/channel-moments"
import type { Channel } from "@/types"

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
      <div className="flex justify-end">
        <button
          type="button"
          aria-pressed={none}
          onClick={() => setNone(!none)}
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${none ? "bg-app-ink/10" : "text-app-ink/60"}`}
        >
          No value
        </button>
      </div>
      {!none && (
        <TimeBoundEditor
          value={bound}
          onChange={setBound}
          opts={{ openEnds: true, ahead: true }}
          modeLabel={`${m.label} mode`}
        />
      )}
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
