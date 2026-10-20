/**
 * PROTOTYPE (time-bound): a Time bound edited with the Analysis window's own
 * editor. `useTimeBoundSource` turns a bound into the four fields the Posts
 * editor reads (Start, End, Duration, End gap); `TimeBoundEditor` embeds that
 * editor in a condition menu, `TimeBoundBar` puts it behind the Posts tab's
 * collapsed line. Throwaway: fold the winner in, delete this.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  WindowEditor,
  type WindowEditorSource,
  WindowEditorSourceContext,
  WindowOverlay,
} from "@/components/AnalysisWindowControl"
import { DRAFT_COMMIT_MS } from "@/contexts/ScopeContext"
import { floorToMinute, MINUTE_MS } from "@/lib/analysis-window"
import {
  ERRORS,
  formatElapsed,
  formatLocalMinute,
  formatLocalStamp,
  parseElapsed,
  parseLocalMinute,
  SCOPE_FIELDS,
  type ScopeField,
  type WindowMode,
} from "@/lib/scope/window"

/** `[start, end)`, either end open. Live ends are signed ms from now. */
export type TimeBound = { mode: WindowMode; start?: number; end?: number }

export type TimeBoundOptions = {
  /** Either end may be left open (blank). */
  openEnds?: boolean
  /** A Live end may point ahead of now (a negative End gap). */
  ahead?: boolean
}

const now = () => floorToMinute(Date.now())

/** The bound's ends as epoch ms against `at`. */
export function resolveTimeBound(b: TimeBound, at = Date.now()) {
  const shift = b.mode === "live" ? at : 0
  return {
    start: b.start === undefined ? undefined : b.start + shift,
    end: b.end === undefined ? undefined : b.end + shift,
  }
}

export function inTimeBound(ms: number, b: TimeBound, at = Date.now()) {
  const { start, end } = resolveTimeBound(b, at)
  return (start === undefined || ms >= start) && (end === undefined || ms < end)
}

const fromAbs = (
  mode: WindowMode,
  ms: number | undefined,
  at: number,
): number | undefined =>
  ms === undefined ? undefined : mode === "live" ? ms - at : ms

function relative(ms: number): string {
  if (Math.abs(ms) < MINUTE_MS) return "now"
  return ms < 0 ? `${formatElapsed(-ms)} ago` : `in ${formatElapsed(ms)}`
}

/** `Live · 7d ago → now (7d)`, `Fixed · Sep 10 09:30 → open`. */
export function timeBoundSummary(b: TimeBound, at = now()): string {
  const { start, end } = resolveTimeBound(b, at)
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

type Result = { ok: true; bound: TimeBound } | { ok: false; error: string }

/** One field's value applied to the bound; `null` opens that end. */
function applyBoundField(
  b: TimeBound,
  field: ScopeField,
  value: number | null,
  opts: TimeBoundOptions,
  at: number,
): Result {
  let { start: s, end: e } = resolveTimeBound(b, at)
  if (value === null && !opts.openEnds)
    return { ok: false, error: "This needs a value." }
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
    bound: {
      mode: b.mode,
      start: fromAbs(b.mode, s, at),
      end: fromAbs(b.mode, e, at),
    },
  }
}

function boundFieldText(b: TimeBound, field: ScopeField, at: number): string {
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

type Parsed = { ok: true; value: number | null } | { ok: false; error: string }

function parseBoundField(field: ScopeField, text: string): Parsed {
  const t = text.trim()
  if (t === "") return { ok: true, value: null }
  if (field === "start" || field === "end") {
    const ms = parseLocalMinute(t)
    return ms === null
      ? { ok: false, error: ERRORS.timestamp }
      : { ok: true, value: ms }
  }
  const negative = field === "endGap" && t.startsWith("-")
  const ms = parseElapsed(negative ? t.slice(1) : t)
  if (ms === null) return { ok: false, error: ERRORS.grammar }
  return { ok: true, value: negative ? -ms : ms }
}

/** A Time bound as the four fields the Analysis window editor reads. */
export function useTimeBoundSource(
  value: TimeBound,
  onChange: (next: TimeBound) => void,
  opts: TimeBoundOptions,
): WindowEditorSource {
  const valueRef = useRef(value)
  valueRef.current = value
  const changeRef = useRef(onChange)
  changeRef.current = onChange
  const [drafts, setDrafts] = useState<Partial<Record<ScopeField, string>>>({})
  const draftsRef = useRef(drafts)
  const [errors, setErrors] = useState<Partial<Record<ScopeField, string>>>({})
  const timers = useRef(new Map<ScopeField, ReturnType<typeof setTimeout>>())
  // A Live bound's fields move with the clock, as the Posts editor's do.
  const [at, setAt] = useState(now)
  useEffect(() => {
    const id = setInterval(() => setAt(now()), 15_000)
    return () => clearInterval(id)
  }, [])

  const settle = useCallback((field: ScopeField, error?: string) => {
    const timer = timers.current.get(field)
    if (timer) clearTimeout(timer)
    timers.current.delete(field)
    if (error) {
      setErrors((open) => ({ ...open, [field]: error }))
      return
    }
    const { [field]: _d, ...rest } = draftsRef.current
    draftsRef.current = rest
    setDrafts(rest)
    setErrors(({ [field]: _e, ...others }) => others)
  }, [])

  const apply = useCallback(
    (field: ScopeField, v: number | null) => {
      const t = now()
      const r = applyBoundField(valueRef.current, field, v, opts, t)
      if (!r.ok) return r.error
      setAt(t)
      changeRef.current(r.bound)
      return null
    },
    [opts],
  )

  const attempt = useCallback(
    (field: ScopeField, text: string) => {
      const parsed = parseBoundField(field, text)
      if (!parsed.ok) return settle(field, parsed.error)
      settle(field, apply(field, parsed.value) ?? undefined)
    },
    [apply, settle],
  )

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
    }
  }, [])

  return useMemo<WindowEditorSource>(
    () => ({
      mode: value.mode,
      setMode: (mode) => {
        const t = now()
        const { start, end } = resolveTimeBound(valueRef.current, t)
        changeRef.current({
          mode,
          start: fromAbs(mode, start, t),
          end: fromAbs(mode, end, t),
        })
      },
      applyValue: (field, v) => {
        const error = apply(field, v)
        settle(field, error ?? undefined)
        return error
      },
      draftText: (field) => drafts[field] ?? boundFieldText(value, field, at),
      setDraft: (field, text) => {
        draftsRef.current = { ...draftsRef.current, [field]: text }
        setDrafts(draftsRef.current)
        setErrors(({ [field]: _e, ...others }) => others)
        const existing = timers.current.get(field)
        if (existing) clearTimeout(existing)
        timers.current.set(
          field,
          setTimeout(() => attempt(field, text), DRAFT_COMMIT_MS),
        )
      },
      commitDraft: (field) => {
        const text = draftsRef.current[field]
        if (text !== undefined) attempt(field, text)
      },
      errors,
    }),
    [value, drafts, errors, at, apply, attempt, settle],
  )
}

const HINT = "text-[11px] text-app-ink/50"

function Hint({ opts }: { opts: TimeBoundOptions }) {
  if (!opts.openEnds && !opts.ahead) return null
  return (
    <p className={HINT}>
      {opts.openEnds && "Clear Start or End to leave that end open. "}
      {opts.ahead && "A negative End gap (-2d) ends ahead of now."}
    </p>
  )
}

/** The editor inside a condition menu: no trigger, the caller's chrome around it. */
export function TimeBoundEditor({
  value,
  onChange,
  opts,
  modeLabel,
}: {
  value: TimeBound
  onChange: (next: TimeBound) => void
  opts: TimeBoundOptions
  modeLabel: string
}) {
  const source = useTimeBoundSource(value, onChange, opts)
  return (
    <WindowEditorSourceContext.Provider value={source}>
      <div className="space-y-2">
        <WindowEditor modeLabel={modeLabel} />
        <Hint opts={opts} />
      </div>
    </WindowEditorSourceContext.Provider>
  )
}

/** The Posts tab's collapsed line and popover, over a Time bound. */
export function TimeBoundBar({
  label,
  value,
  onChange,
  opts,
}: {
  label: string
  value: TimeBound
  onChange: (next: TimeBound) => void
  opts: TimeBoundOptions
}) {
  const [open, setOpen] = useState(false)
  const source = useTimeBoundSource(value, onChange, opts)
  return (
    <WindowOverlay
      label={label}
      summary={timeBoundSummary(value)}
      open={open}
      onOpenChange={(next) => {
        if (!next) for (const field of SCOPE_FIELDS) source.commitDraft(field)
        setOpen(next)
      }}
    >
      <WindowEditorSourceContext.Provider value={source}>
        <div className="space-y-2">
          <WindowEditor modeLabel={`${label} mode`} />
          <Hint opts={opts} />
        </div>
      </WindowEditorSourceContext.Provider>
    </WindowOverlay>
  )
}
