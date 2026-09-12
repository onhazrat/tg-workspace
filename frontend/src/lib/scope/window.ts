/**
 * The Analysis window as one canonical state, and every rule for changing it
 * (AW-03).
 *
 * Before this module the workspace held two independent timestamps. Each setter
 * silently repaired the other boundary when an edit crossed it, and silently
 * clamped an end that had run past now. Two stored facts with two repair rules
 * is three ways to disagree, and the repairs happened with nothing on screen to
 * admit they had.
 *
 * What replaces them is a state that is *mode-specific and never redundant*:
 *
 * - Live is a Duration and an End gap. Start and End are derived from the
 *   synchronised current minute, so they move on their own.
 * - Fixed is two exact instants. Duration and End gap are derived from them.
 *
 * The four fields an Account sees are therefore always four views of two facts.
 * There is nothing to drift.
 *
 * Every edit lands as a candidate `[start, end)` pair, is validated once, and is
 * then re-canonicalised for the current mode. An invalid candidate returns a
 * message and changes nothing — no swap, no clamp, no collapse. That is the
 * whole of what this ticket replaces: the same input is now an error the person
 * can see instead of a repair they cannot.
 *
 * Nothing here reads a clock. The current minute arrives as an argument so the
 * controller's temporal behaviour is testable without wall time, and so the
 * minute is always the *server's* (see `lib/analysis-window.ts`) rather than
 * this browser's.
 */

import {
  type AnalysisWindowInput,
  floorToMinute,
  MINUTE_MS,
} from "@/lib/analysis-window"
import { scopedStorage } from "@/lib/storage/scoped"

export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS

/** The canonical state. Two facts, never four. */
export type WindowState =
  | { mode: "live"; durationMs: number; endGapMs: number }
  | { mode: "fixed"; start: number; end: number }

export type WindowMode = WindowState["mode"]

/** The four fields the editor presents, all derived from `WindowState`. */
export type ScopeField = "start" | "end" | "duration" | "endGap"

export const SCOPE_FIELDS: readonly ScopeField[] = [
  "start",
  "end",
  "duration",
  "endGap",
]

/** A new Account's window: the last 24 hours, ending at the current minute. */
export const DEFAULT_WINDOW: WindowState = {
  mode: "live",
  durationMs: DAY_MS,
  endGapMs: 0,
}

/**
 * The canonical state as the server's request contract states it (AW-05).
 *
 * A submission sends *this*, never the two instants `resolveWindow` derives. A
 * Live window flattened in the browser stops being Live the moment it leaves:
 * the server resolves it again against its own minute, so sending the pair
 * would hand over a selection made by this laptop's clock and call it a choice.
 */
export function toWireWindow(state: WindowState): AnalysisWindowInput {
  if (state.mode === "fixed") {
    return { mode: "fixed", start: state.start, end: state.end }
  }
  return {
    mode: "live",
    durationMinutes: Math.round(state.durationMs / MINUTE_MS),
    endGapMinutes: Math.round(state.endGapMs / MINUTE_MS),
  }
}

/** All four displayed values at one instant. */
export interface ResolvedWindow {
  mode: WindowMode
  start: number
  end: number
  durationMs: number
  endGapMs: number
}

export type FieldResult =
  | { ok: true; value: number }
  | { ok: false; error: string }

export type CommitResult =
  | { ok: true; state: WindowState }
  | { ok: false; error: string }

export const ERRORS = {
  duration: "Duration must be at least 1 minute.",
  future: "End cannot be later than the current minute.",
  grammar: "Use whole minutes, largest unit first — for example 1d 6h.",
  timestamp: "Use a date and time.",
} as const

export function resolveWindow(
  state: WindowState,
  minuteNow: number,
): ResolvedWindow {
  if (state.mode === "live") {
    const end = minuteNow - state.endGapMs
    return {
      mode: "live",
      start: end - state.durationMs,
      end,
      durationMs: state.durationMs,
      endGapMs: state.endGapMs,
    }
  }
  return {
    mode: "fixed",
    start: state.start,
    end: state.end,
    durationMs: state.end - state.start,
    // A Fixed end is never in the future when it is stored, but the minute it
    // was stored against keeps moving, so the gap only ever grows. The floor at
    // zero is for the one instant where the two are the same.
    endGapMs: Math.max(0, minuteNow - state.end),
  }
}

/**
 * Re-express a `[start, end)` pair as canonical state for `mode`.
 *
 * Every edit and every mode switch funnels through here, which is why there is
 * exactly one place that decides what Live and Fixed *are*.
 */
function canonicalise(
  mode: WindowMode,
  start: number,
  end: number,
  minuteNow: number,
): WindowState {
  if (mode === "live") {
    return { mode: "live", durationMs: end - start, endGapMs: minuteNow - end }
  }
  return { mode: "fixed", start, end }
}

function validate(
  start: number,
  end: number,
  minuteNow: number,
): string | null {
  if (end > minuteNow) return ERRORS.future
  if (end - start < MINUTE_MS) return ERRORS.duration
  return null
}

/**
 * Apply one field edit.
 *
 * `value` is an exact instant for `start` and `end`, and elapsed milliseconds
 * for `duration` and `endGap`. Each field has exactly one propagation rule, and
 * all four reduce to a new pair:
 *
 * - Start holds End, so Duration changes.
 * - End holds Start, so Duration and End gap change.
 * - Duration holds End and End gap, so Start changes.
 * - End gap holds Duration, so End and Start both change.
 *
 * The rules are the same in both modes. What differs is only which two of the
 * four numbers are then stored.
 */
export function applyField(
  state: WindowState,
  minuteNow: number,
  field: ScopeField,
  value: number,
): CommitResult {
  const current = resolveWindow(state, minuteNow)
  let start = current.start
  let end = current.end

  switch (field) {
    case "start":
      start = floorToMinute(value)
      break
    case "end":
      end = floorToMinute(value)
      break
    case "duration":
      start = end - value
      break
    case "endGap":
      end = minuteNow - value
      start = end - current.durationMs
      break
  }

  const error = validate(start, end, minuteNow)
  if (error) return { ok: false, error }
  return { ok: true, state: canonicalise(state.mode, start, end, minuteNow) }
}

/**
 * Switch mode without moving anything.
 *
 * A switch commits immediately and changes none of the four displayed values at
 * the switching instant; only later clock movement reveals which mode is in
 * force. That is what makes the choice reversible — an Account can look at a
 * Live window, freeze it, and be certain they froze what they were reading.
 */
export function switchMode(
  state: WindowState,
  minuteNow: number,
  mode: WindowMode,
): WindowState {
  if (state.mode === mode) return state
  const current = resolveWindow(state, minuteNow)
  return canonicalise(mode, current.start, current.end, minuteNow)
}

/**
 * The shortest legal window containing `[start, end)`.
 *
 * For values that are not being typed: a restored Artifact Scope, a command, a
 * preset. A person editing a field gets `applyField`'s refusal instead, because
 * there the value is on screen and there is somebody to tell.
 */
export function fixedRange(
  start: number,
  end: number,
  minuteNow: number,
): WindowState {
  const finalEnd = Math.min(floorToMinute(end), minuteNow)
  return {
    mode: "fixed",
    start: Math.min(floorToMinute(start), finalEnd - MINUTE_MS),
    end: finalEnd,
  }
}

/* ------------------------------------------------------------------ */
/* Elapsed time: a deliberately small grammar                          */
/* ------------------------------------------------------------------ */

const UNIT_MS: Record<string, number> = { d: DAY_MS, h: HOUR_MS, m: MINUTE_MS }
const UNITS = ["d", "h", "m"] as const

/**
 * Whole-minute tokens in strictly descending unit order: `1d 6h`, `2h 30m`,
 * `0m`.
 *
 * Not a date parser. Anything ambiguous — an unknown unit, a fraction, a sign,
 * a repeated or ascending unit, trailing prose — is rejected rather than
 * guessed at, because a guess here silently selects Posts nobody asked for.
 * Whitespace is the one forgiving part.
 */
export function parseElapsed(text: string): number | null {
  const compact = text.trim().toLowerCase().replace(/\s+/g, "")
  if (!/^(\d+[dhm])+$/.test(compact)) return null

  let total = 0
  let previous = -1
  for (const match of compact.matchAll(/(\d+)([dhm])/g)) {
    const index = UNITS.indexOf(match[2] as (typeof UNITS)[number])
    if (index <= previous) return null
    previous = index
    total += Number(match[1]) * UNIT_MS[match[2]]
  }
  return total
}

/** The inverse of `parseElapsed`, so every rendered value can be retyped. */
export function formatElapsed(ms: number): string {
  if (ms < MINUTE_MS) return "0m"
  let rest = ms
  const parts: string[] = []
  for (const unit of UNITS) {
    const count = Math.floor(rest / UNIT_MS[unit])
    if (count > 0) {
      parts.push(`${count}${unit}`)
      rest -= count * UNIT_MS[unit]
    }
  }
  return parts.join(" ")
}

/* ------------------------------------------------------------------ */
/* Exact instants: local in, UTC stored                                */
/* ------------------------------------------------------------------ */

const LOCAL_MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

/** `2026-09-10T09:30` in this browser's zone, as an exact UTC instant. */
export function parseLocalMinute(text: string): number | null {
  const trimmed = text.trim()
  if (!LOCAL_MINUTE.test(trimmed)) return null
  const ms = new Date(trimmed).getTime()
  return Number.isNaN(ms) ? null : floorToMinute(ms)
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

/** What a `datetime-local` input wants. Local, no zone, no seconds. */
export function formatLocalMinute(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

/** `Sep 10 09:30` — local, and deliberately carrying no zone or offset. */
export function formatLocalStamp(ms: number): string {
  const d = new Date(ms)
  return `${MONTHS[d.getMonth()]} ${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/* ------------------------------------------------------------------ */
/* Fields: text in, text out                                           */
/* ------------------------------------------------------------------ */

/**
 * What a field shows. Live boundaries are relative, Fixed boundaries are exact
 * local date-times, and the two elapsed fields are elapsed in both modes.
 */
export function fieldText(
  resolved: ResolvedWindow,
  minuteNow: number,
  field: ScopeField,
): string {
  switch (field) {
    case "start":
      return resolved.mode === "live"
        ? formatElapsed(minuteNow - resolved.start)
        : formatLocalMinute(resolved.start)
    case "end":
      return resolved.mode === "live"
        ? formatElapsed(resolved.endGapMs)
        : formatLocalMinute(resolved.end)
    case "duration":
      return formatElapsed(resolved.durationMs)
    case "endGap":
      return formatElapsed(resolved.endGapMs)
  }
}

/** Turn a typed field into the number `applyField` takes, or say why not. */
export function parseField(
  mode: WindowMode,
  minuteNow: number,
  field: ScopeField,
  text: string,
): FieldResult {
  if (field === "duration" || field === "endGap") {
    const elapsed = parseElapsed(text)
    if (elapsed === null) return { ok: false, error: ERRORS.grammar }
    return { ok: true, value: elapsed }
  }

  if (mode === "live") {
    const elapsed = parseElapsed(text)
    if (elapsed === null) return { ok: false, error: ERRORS.grammar }
    return { ok: true, value: minuteNow - elapsed }
  }

  const instant = parseLocalMinute(text)
  if (instant === null) return { ok: false, error: ERRORS.timestamp }
  return { ok: true, value: instant }
}

function ago(ms: number): string {
  return ms < MINUTE_MS ? "now" : `${formatElapsed(ms)} ago`
}

/** `Live · 1d 10h ago → 30m ago (1d 9h 30m)` / `Fixed · Sep 10 09:30 → …`. */
export function formatWindowSummary(
  resolved: ResolvedWindow,
  minuteNow: number,
): string {
  const duration = formatElapsed(resolved.durationMs)
  if (resolved.mode === "live") {
    return `Live · ${ago(minuteNow - resolved.start)} → ${ago(resolved.endGapMs)} (${duration})`
  }
  return `Fixed · ${formatLocalStamp(resolved.start)} → ${formatLocalStamp(resolved.end)} (${duration})`
}

/* ------------------------------------------------------------------ */
/* Persistence and the one-time migration                              */
/* ------------------------------------------------------------------ */

export const WINDOW_STORAGE_KEY = "analysisWindow"
/** What the two independent timestamps were stored under, before AW-03. */
export const LEGACY_KEYS = ["startDateTs", "endDateTs"] as const

function legalFixed(
  start: number,
  end: number,
  minuteNow: number,
): WindowState | null {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  const s = floorToMinute(start)
  // A stored end past the current minute is *held*, not refused. Before AW-02
  // the workspace wrote its end from this browser's raw `Date.now()`, so a
  // clock running fast — the exact case AW-02 exists for — left a stored end
  // slightly in the future. Refusing it would drop the saved window of
  // precisely the accounts that ticket was written to protect, and there is no
  // field on screen at load time to explain the refusal in.
  const e = Math.min(floorToMinute(end), minuteNow)
  // A crossed or empty pair is a different thing: no clamp recovers an
  // intention from it, so it falls back to the default.
  if (e - s < MINUTE_MS) return null
  return { mode: "fixed", start: s, end: e }
}

function parseState(raw: string, minuteNow: number): WindowState | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null
  const value = parsed as Record<string, unknown>

  if (value.mode === "live") {
    const { durationMs, endGapMs } = value
    if (typeof durationMs !== "number" || typeof endGapMs !== "number") {
      return null
    }
    if (durationMs < MINUTE_MS || endGapMs < 0) return null
    return { mode: "live", durationMs, endGapMs }
  }

  if (value.mode === "fixed") {
    const { start, end } = value
    if (typeof start !== "number" || typeof end !== "number") return null
    return legalFixed(start, end, minuteNow)
  }

  return null
}

/**
 * The Account's last window, or the default.
 *
 * A pair saved before AW-03 migrates to **Fixed**. Nothing infers Live from an
 * end that happens to sit near now: that would be reading an intention into a
 * value the old UI rewrote on every change, and the account would silently
 * acquire a moving window it never chose.
 *
 * Reads only. It is called from a `useState` initialiser, and `StrictMode`
 * invokes those twice while keeping the *second* result — so a migration that
 * consumed the legacy keys here would hand its answer to a discarded render
 * and leave the second pass with nothing to read. What makes the migration
 * stick is {@link retireLegacyWindow}, in an effect, after a render commits.
 */
export function loadWindow(minuteNow: number): WindowState {
  const stored = scopedStorage.getItem(WINDOW_STORAGE_KEY)
  if (stored) {
    const state = parseState(stored, minuteNow)
    if (state) return state
  }

  const [startKey, endKey] = LEGACY_KEYS
  const migrated = legalFixed(
    Number(scopedStorage.getItem(startKey)),
    Number(scopedStorage.getItem(endKey)),
    minuteNow,
  )
  return migrated ?? DEFAULT_WINDOW
}

/**
 * Write the loaded window under the new key and drop the pre-AW-03 one.
 *
 * Idempotent, and safe to run twice: until this has run, `loadWindow` simply
 * re-derives the same answer from the legacy pair every time.
 */
export function retireLegacyWindow(state: WindowState): void {
  saveWindow(state)
  for (const key of LEGACY_KEYS) scopedStorage.removeItem(key)
}

/**
 * Remember the window for this Account, in this browser.
 *
 * Live persists what it *is* — mode, Duration, End gap — and never its resolved
 * timestamps, so reopening the application tomorrow resumes a live window
 * rather than freezing yesterday's. Drafts and errors are not persisted at all.
 *
 * No tab listens for another tab's write. Each open tab keeps its own in-memory
 * window and the last writer merely decides where a future reload starts, so
 * committing in one tab cannot make another tab's work jump.
 */
export function saveWindow(state: WindowState): void {
  scopedStorage.setItem(WINDOW_STORAGE_KEY, JSON.stringify(state))
}

/* ------------------------------------------------------------------ */
/* The shortcut row                                                    */
/* ------------------------------------------------------------------ */

/**
 * One vocabulary for both elapsed fields (AW-04).
 *
 * Duration and End gap share it because they are the same kind of number, and
 * a person who has learned the row on one field has learned it on the other.
 * The tokens are exactly what {@link parseElapsed} accepts, so a shortcut and a
 * typed value are the same act.
 *
 * Zero is absent deliberately. A zero End gap is valid and typeable — it is how
 * a Live window ends at the current minute — but promoting it to a shortcut
 * would advertise an edge value beside seven ordinary ones, and it is not a
 * Duration at all.
 */
export const ELAPSED_PRESETS = [
  "1m",
  "30m",
  "1h",
  "3h",
  "8h",
  "24h",
  "7d",
  "30d",
] as const
