import { type ReactNode, useState } from "react"
import type { DirectoryDistributionResponse } from "@/client"
import { TgButton } from "@/components/ui/tg-button"
import type {
  DirectoryTimeCond,
  Moment,
  TimeMode,
} from "@/lib/directory/directory-filter"
import { type Bin, Spread } from "./DirectoryBoundEditor"

const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }
type Unit = keyof typeof UNIT_MS
const UNIT_NAME: Record<Unit, string> = {
  m: "minutes",
  h: "hours",
  d: "days",
  w: "weeks",
}

/** A Live end as the fields show it; a blank amount is an open end. */
type LiveEnd = { amount: string; unit: Unit; dir: "ago" | "ahead" }
const OPEN_LIVE: LiveEnd = { amount: "", unit: "d", dir: "ago" }

function liveEnd(ms: number | undefined): LiveEnd {
  if (ms === undefined) return OPEN_LIVE
  const size = Math.abs(ms)
  const unit =
    (["w", "d", "h"] as const).find((u) => size % UNIT_MS[u] === 0) ?? "m"
  return {
    amount: String(Math.round(size / UNIT_MS[unit])),
    unit,
    dir: ms > 0 ? "ahead" : "ago",
  }
}
function liveMs(end: LiveEnd): number | undefined {
  const n = Number(end.amount)
  if (end.amount.trim() === "" || !Number.isFinite(n) || n < 0) return undefined
  // Zero is now either way, and never -0, which prints and compares apart.
  if (n === 0) return 0
  return (end.dir === "ahead" ? 1 : -1) * n * UNIT_MS[end.unit]
}

const pad = (n: number) => String(n).padStart(2, "0")
/** Epoch ms as `datetime-local` text in the viewer's zone, to the minute. */
function localText(ms: number | undefined): string {
  if (ms === undefined) return ""
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
/** `datetime-local` text, read in the viewer's zone, as epoch ms. */
function localMs(text: string): number | undefined {
  if (!text) return undefined
  const ms = new Date(text).getTime()
  return Number.isNaN(ms) ? undefined : ms
}

const dateText = (ms: number) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(ms)

const fieldClass =
  "h-8 rounded-md border border-app-ink/15 bg-app-muted px-2 text-xs outline-none focus:border-app-ink/40"

function LiveFields({
  side,
  end,
  onEnd,
}: {
  side: "Start" | "End"
  end: LiveEnd
  onEnd: (end: LiveEnd) => void
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-9 text-[11px] text-app-ink/50">{side}</span>
      <input
        type="number"
        min={0}
        aria-label={`${side} amount`}
        placeholder="open"
        value={end.amount}
        onChange={(e) => onEnd({ ...end, amount: e.target.value })}
        className={`${fieldClass} w-16`}
      />
      <select
        aria-label={`${side} unit`}
        value={end.unit}
        onChange={(e) => onEnd({ ...end, unit: e.target.value as Unit })}
        className={fieldClass}
      >
        {(Object.keys(UNIT_NAME) as Unit[]).map((u) => (
          <option key={u} value={u}>
            {UNIT_NAME[u]}
          </option>
        ))}
      </select>
      <select
        aria-label={`${side} direction`}
        value={end.dir}
        onChange={(e) =>
          onEnd({ ...end, dir: e.target.value as LiveEnd["dir"] })
        }
        className={fieldClass}
      >
        <option value="ago">ago</option>
        <option value="ahead">from now</option>
      </select>
    </div>
  )
}

/**
 * A Time bound in the Directory filter (DPF): Live or Fixed as the Posts
 * tab's Analysis window is, but either end may be left open and a Live end
 * may point ahead. Fixed ends are typed in the viewer's own zone and sent as
 * instants. The spread is drawn by the server in epoch ms, and a click on a
 * bar sets a Fixed range over it. NOT is the chip's, not the editor's.
 */
export function DirectoryTimeEditor({
  moment,
  initial,
  distribution,
  countFor,
  onSubmit,
  onBack,
}: {
  moment: Moment
  /** The Condition being changed; without one the editor adds. */
  initial?: DirectoryTimeCond
  distribution?: DirectoryDistributionResponse
  countFor: (cond: DirectoryTimeCond) => ReactNode
  onSubmit: (cond: DirectoryTimeCond) => void
  onBack?: () => void
}) {
  const [mode, setMode] = useState<TimeMode>(initial?.mode ?? "live")
  const [none, setNone] = useState(!!initial?.none)
  const fixed = initial?.mode === "fixed"
  const [live, setLive] = useState(() => ({
    start: liveEnd(fixed ? undefined : initial?.start),
    end: liveEnd(fixed ? undefined : initial?.end),
  }))
  const [at, setAt] = useState(() => ({
    start: localText(fixed ? initial?.start : undefined),
    end: localText(fixed ? initial?.end : undefined),
  }))

  const [start, end] =
    mode === "live"
      ? [liveMs(live.start), liveMs(live.end)]
      : [localMs(at.start), localMs(at.end)]
  const cond: DirectoryTimeCond | null = none
    ? { type: "time", moment: moment.key, mode, none: true }
    : (start === undefined && end === undefined) ||
        (start !== undefined && end !== undefined && end <= start)
      ? null
      : {
          type: "time",
          moment: moment.key,
          mode,
          ...(start !== undefined && { start }),
          ...(end !== undefined && { end }),
        }
  // The bars are in epoch ms, so a Live end is placed against now.
  const now = Date.now()
  const shift = mode === "live" ? now : 0
  const highlight = cond &&
    !none && {
      ...(start !== undefined && { min: start + shift }),
      ...(end !== undefined && { max: end + shift }),
    }

  const onBar = (bin: Bin) => {
    setNone(false)
    setMode("fixed")
    setAt({ start: localText(bin.lo), end: localText(bin.hi) })
  }
  const toggle = "rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
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
      {distribution ? (
        <Spread
          spread={distribution}
          bound={highlight || null}
          onBar={onBar}
          format={dateText}
        />
      ) : (
        <p className="text-[11px] text-app-ink/50">Loading the spread…</p>
      )}
      <div className="flex gap-1 rounded-full bg-app-ink/5 p-0.5">
        {(["live", "fixed"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={!none && mode === m}
            onClick={() => {
              setNone(false)
              setMode(m)
            }}
            className={`${toggle} ${!none && mode === m ? "bg-app-surface shadow-sm" : "text-app-ink/60"}`}
          >
            {m === "live" ? "Live" : "Fixed"}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={none}
          onClick={() => setNone(!none)}
          className={`${toggle} ml-auto ${none ? "bg-app-surface shadow-sm" : "text-app-ink/60"}`}
        >
          No value
        </button>
      </div>
      {!none && mode === "live" && (
        <div className="space-y-1">
          <LiveFields
            side="Start"
            end={live.start}
            onEnd={(e) => setLive({ ...live, start: e })}
          />
          <LiveFields
            side="End"
            end={live.end}
            onEnd={(e) => setLive({ ...live, end: e })}
          />
          <p className="text-[11px] text-app-ink/50">
            Moves with the clock. 0 is now; leave an amount blank to leave that
            end open.
          </p>
        </div>
      )}
      {!none && mode === "fixed" && (
        <div className="space-y-1">
          {(["start", "end"] as const).map((side) => (
            <label key={side} className="flex items-center gap-1 text-[11px]">
              <span className="w-9 text-app-ink/50">
                {side === "start" ? "From" : "Before"}
              </span>
              <input
                type="datetime-local"
                aria-label={side === "start" ? "Start" : "End"}
                value={at[side]}
                onChange={(e) => setAt({ ...at, [side]: e.target.value })}
                className={`${fieldClass} flex-1`}
              />
            </label>
          ))}
          <p className="text-[11px] text-app-ink/50">
            In your time zone. Leave one blank to leave that end open.
          </p>
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
