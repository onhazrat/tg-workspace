/**
 * The one Time bound text form and its chip words (TB-01, ADR-033).
 *
 * A Live end is a signed offset from now (`-3d`, `+2d`, `now`), a Fixed end a
 * UTC instant (`2026-10-01T00:00Z`), and `..` sits between them with either
 * side left out for an open end. Every filter that writes a Time bound into a
 * URL writes it this way, so one syntax means one thing in every tab.
 */
import { ParseError } from "@/lib/filter-text"
import type { TimeBound } from "./bound"

const UNITS = [
  ["w", 7 * 86_400_000, "week"],
  ["d", 86_400_000, "day"],
  ["h", 3_600_000, "hour"],
  ["m", 60_000, "minute"],
  ["s", 1000, "second"],
] as const

const UNIT_MS: Record<string, number> = Object.fromEntries(
  UNITS.map(([unit, size]) => [unit, size]),
)

/** The largest unit `ms` is a whole number of: [count, unit]. */
function inUnits(ms: number): [number, (typeof UNITS)[number]] {
  const unit =
    UNITS.find(([, size]) => ms % size === 0) ?? UNITS[UNITS.length - 1]
  return [Math.round(ms / unit[1]), unit]
}

const INSTANT = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z`
const OFFSET = String.raw`now|[+-]\d+[wdhms]`
/** One end, as a regular expression source with one capture group. */
export const END = `(${INSTANT}|${OFFSET})`
/** A whole bound, `<start>..<end>`: two capture groups, either may be empty. */
export const TIME_BOUND = String.raw`${END}?\.\.${END}?`

/** A Fixed end as UTC, to the minute when the seconds are zero. */
export function instantText(ms: number): string {
  const iso = new Date(ms).toISOString()
  return iso.endsWith(":00.000Z")
    ? `${iso.slice(0, 16)}Z`
    : iso.replace(".000Z", "Z")
}

/** A Live end: `now`, or a signed whole number of the largest unit. */
export function offsetText(ms: number): string {
  if (ms === 0) return "now"
  const [n, [unit]] = inUnits(Math.abs(ms))
  return `${ms < 0 ? "-" : "+"}${n}${unit}`
}

/** `-3d..`, `now..+2d`, `2026-10-01T00:00Z..2026-10-15T00:00Z`. */
export function timeBoundText(bound: TimeBound): string {
  const end = bound.mode === "fixed" ? instantText : offsetText
  const at = (ms: number | undefined) => (ms === undefined ? "" : end(ms))
  return `${at(bound.start)}..${at(bound.end)}`
}

/** One end's text: an offset (Live) or an instant (Fixed). */
export function endValue(text: string): {
  mode: TimeBound["mode"]
  ms: number
} {
  if (text === "now") return { mode: "live", ms: 0 }
  const offset = /^([+-])(\d+)([wdhms])$/.exec(text)
  if (offset)
    return {
      mode: "live",
      ms: (offset[1] === "-" ? -1 : 1) * Number(offset[2]) * UNIT_MS[offset[3]],
    }
  return { mode: "fixed", ms: Date.parse(text) }
}

/**
 * The two ends `TIME_BOUND` captured, as a bound. Refuses a bound with no end, one
 * mixing Live and Fixed, and one ending at or before its start.
 */
export function parseTimeBound(start?: string, end?: string): TimeBound {
  if (!start && !end) throw new ParseError("A Time bound needs an end")
  const ends = [start, end].map((e) => (e ? endValue(e) : undefined))
  const modes = [...new Set(ends.flatMap((e) => (e ? [e.mode] : [])))]
  if (modes.length > 1)
    throw new ParseError("A Time bound mixes Live and Fixed")
  const [from, to] = ends.map((e) => e?.ms)
  if (from !== undefined && to !== undefined && to <= from)
    throw new ParseError("A Time bound ends before it starts")
  return {
    mode: modes[0],
    ...(from !== undefined && { start: from }),
    ...(to !== undefined && { end: to }),
  }
}

/** One end in words: "7 days ago", "in 2 days", "now", a local date and time. */
export function endWords(
  mode: TimeBound["mode"],
  ms: number,
  locale?: string,
  timeZone?: string,
): string {
  if (mode === "fixed")
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(ms)
  if (ms === 0) return "now"
  const [n, [, , name]] = inUnits(Math.abs(ms))
  const span = `${n} ${name}${n === 1 ? "" : "s"}`
  return ms < 0 ? `${span} ago` : `in ${span}`
}

/** A chip: "Last post from 3 days ago", "Found before 50 days ago". */
export function timeBoundWords(
  name: string,
  cond: TimeBound & { none?: boolean },
  locale?: string,
  /** Fixed ends read in the viewer's zone unless one is named. */
  timeZone?: string,
): string {
  if (cond.none) return `${name}: no value`
  const end = (ms: number) => endWords(cond.mode, ms, locale, timeZone)
  if (cond.start !== undefined && cond.end !== undefined)
    return `${name} from ${end(cond.start)} to ${end(cond.end)}`
  if (cond.start !== undefined) return `${name} from ${end(cond.start)}`
  return `${name} before ${end(cond.end ?? 0)}`
}
