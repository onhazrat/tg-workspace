/**
 * A Time bound (TB-01, ADR-033): `[start, end)`, either end open. A Live end
 * is signed ms from now, negative for the past; a Fixed end is epoch ms.
 *
 * This is the half that reads no clock and touches no React: what each of
 * the Analysis window editor's four fields means for a bound. The other half
 * is `components/TimeBoundEditor.tsx`.
 */
import { floorToMinute, MINUTE_MS } from "@/lib/analysis-window"
import {
  ERRORS,
  formatElapsed,
  formatLocalMinute,
  formatLocalStamp,
  parseElapsed,
  parseLocalMinute,
  type ScopeField,
  type WindowMode,
} from "@/lib/scope/window"

export type TimeBound = { mode: WindowMode; start?: number; end?: number }

/** What a filter turns on in the one editor. */
export type TimeBoundOptions = {
  /** Either end may be left open (blank). */
  openEnds?: boolean
  /** A Live end may point ahead of now (a negative End gap). */
  ahead?: boolean
}

/** What a moment's Time bound turns on (ADR-033): all three switches. */
export const MOMENT_OPTIONS: TimeBoundOptions = { openEnds: true, ahead: true }

/** The bound's ends as epoch ms against `at`. */
export function resolveTimeBound(b: TimeBound, at: number) {
  const shift = b.mode === "live" ? at : 0
  return {
    start: b.start === undefined ? undefined : b.start + shift,
    end: b.end === undefined ? undefined : b.end + shift,
  }
}

/**
 * The Fixed bound over values from `oldest` to `newest`, rounded out to whole
 * minutes, its End one minute past the newest, so it keeps both.
 */
export function minuteBound(oldest: number, newest: number): TimeBound {
  return {
    mode: "fixed",
    start: floorToMinute(oldest),
    end: floorToMinute(newest) + MINUTE_MS,
  }
}

/**
 * The bound a clicked bar of a server's spread sets. A bar counts `[lo, hi)`
 * and the last one `[lo, hi]`, so its newest value is just under `hi`, or `hi`.
 */
export function barBound(
  bin: { lo: number; hi: number },
  last: boolean,
): TimeBound {
  return minuteBound(bin.lo, last ? bin.hi : Math.ceil(bin.hi) - 1)
}

/** Whether an instant falls inside the bound, `[start, end)`, against `at`. */
export function inTimeBound(ms: number, b: TimeBound, at: number): boolean {
  const { start, end } = resolveTimeBound(b, at)
  return (start === undefined || ms >= start) && (end === undefined || ms < end)
}

/** Epoch ms ends back into a bound in `mode`'s own terms, open ends left out. */
function toBound(
  mode: WindowMode,
  start: number | undefined,
  end: number | undefined,
  at: number,
): TimeBound {
  const shift = mode === "live" ? at : 0
  return {
    mode,
    ...(start !== undefined && { start: start - shift }),
    ...(end !== undefined && { end: end - shift }),
  }
}

/** The same ends in the other mode, as the Posts editor's switch does. */
export function switchTimeBoundMode(
  b: TimeBound,
  mode: WindowMode,
  at: number,
): TimeBound {
  const { start, end } = resolveTimeBound(b, at)
  return toBound(mode, start, end, at)
}

function relative(ms: number): string {
  if (Math.abs(ms) < MINUTE_MS) return "now"
  return ms < 0 ? `${formatElapsed(-ms)} ago` : `in ${formatElapsed(ms)}`
}

/** `Live · 7d ago → now (7d)`, `Fixed · Sep 10 09:30 → open`, `Any time`. */
export function timeBoundSummary(b: TimeBound, at: number): string {
  const { start, end } = resolveTimeBound(b, at)
  if (start === undefined && end === undefined) return "Any time"
  const side = (ms: number | undefined) =>
    ms === undefined
      ? "open"
      : b.mode === "live"
        ? relative(ms - at)
        : formatLocalStamp(ms)
  const span =
    start !== undefined && end !== undefined
      ? ` (${formatElapsed(end - start)})`
      : ""
  return `${b.mode === "live" ? "Live" : "Fixed"} · ${side(start)} → ${side(end)}${span}`
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * A typed field as the number `applyBoundField` takes; `null` is a blank,
 * which opens an end only where open ends are allowed. A leading `-` on End
 * gap is ahead of now, read only where ahead is allowed.
 */
export function parseBoundField(
  field: ScopeField,
  text: string,
  opts: TimeBoundOptions,
): Result<number | null> {
  const t = text.trim()
  if (t === "" && opts.openEnds) return { ok: true, value: null }
  if (field === "start" || field === "end") {
    const ms = parseLocalMinute(t)
    return ms === null
      ? { ok: false, error: ERRORS.timestamp }
      : { ok: true, value: ms }
  }
  const ahead = field === "endGap" && !!opts.ahead && t.startsWith("-")
  const ms = parseElapsed(ahead ? t.slice(1) : t)
  if (ms === null) return { ok: false, error: ERRORS.grammar }
  return { ok: true, value: ahead ? -ms : ms }
}

/**
 * One field applied to the bound. Start and End are instants; Duration sets
 * Start from End (End from Start when End is open, both from now when both
 * are); End gap moves End and keeps the Duration. Refuses an End past now
 * unless ahead is allowed, and a bound under a minute long.
 */
export function applyBoundField(
  b: TimeBound,
  field: ScopeField,
  value: number | null,
  opts: TimeBoundOptions,
  at: number,
): Result<TimeBound> {
  let { start: s, end: e } = resolveTimeBound(b, at)
  if (field === "start") s = value ?? undefined
  if (field === "end") e = value ?? undefined
  if (field === "duration" && value !== null) {
    if (e !== undefined) s = e - value
    else if (s !== undefined) e = s + value
    else [s, e] = [at - value, at]
  }
  if (field === "endGap") {
    const next = value === null ? undefined : at - value
    if (next !== undefined && s !== undefined && e !== undefined)
      s = next - (e - s)
    e = next
  }
  if (!opts.ahead && e !== undefined && e > at)
    return { ok: false, error: ERRORS.future }
  if (s !== undefined && e !== undefined && e - s < MINUTE_MS)
    return { ok: false, error: ERRORS.duration }
  return {
    ok: true,
    value: toBound(b.mode, s, e, at),
  }
}

/** What a field shows for the bound; a blank where an end is open. */
export function boundFieldText(
  b: TimeBound,
  field: ScopeField,
  at: number,
): string {
  const { start, end } = resolveTimeBound(b, at)
  switch (field) {
    case "start":
      return start === undefined ? "" : formatLocalMinute(start)
    case "end":
      return end === undefined ? "" : formatLocalMinute(end)
    case "duration":
      return start === undefined || end === undefined
        ? ""
        : formatElapsed(end - start)
    case "endGap": {
      if (end === undefined) return ""
      const gap = at - end
      return gap >= 0 ? formatElapsed(gap) : `-${formatElapsed(-gap)}`
    }
  }
}
