/**
 * A Time bound edited with the Analysis window's own editor (TB-01, ADR-033).
 *
 * `useTimeBoundSource` turns a bound into the four fields the Posts editor
 * reads (Start, End, Duration, End gap), with its drafts, debounce and error
 * messages. Two wrappers carry it: `TimeBoundEditor` embeds the editor in a
 * condition menu (Directory, Channels), `TimeBoundBar` puts it behind the
 * Posts tab's collapsed line and popover (Logs). What a bound means per field
 * is `lib/time-bound/bound.ts`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  WindowEditor,
  type WindowEditorSource,
  WindowEditorSourceContext,
  WindowOverlay,
} from "@/components/AnalysisWindowControl"
import { DRAFT_COMMIT_MS } from "@/contexts/ScopeContext"
import { floorToMinute, serverNow } from "@/lib/analysis-window"
import { SCOPE_FIELDS, type ScopeField } from "@/lib/scope/window"
import {
  applyBoundField,
  boundFieldText,
  parseBoundField,
  switchTimeBoundMode,
  type TimeBound,
  type TimeBoundOptions,
  timeBoundSummary,
} from "@/lib/time-bound/bound"

/** The server's current minute, never this browser's own. */
const minuteNow = () => floorToMinute(serverNow())

/** How often a Live bound's fields are redrawn against the clock. */
const REDRAW_MS = 15_000

type Drafts = Partial<Record<ScopeField, string>>

/** No value, offered as the mode switch's third segment. */
export type NoValue = { on: boolean; onChange: (on: boolean) => void }

/** A Time bound as the four fields the Analysis window editor reads. */
export function useTimeBoundSource(
  value: TimeBound,
  onChange: (next: TimeBound) => void,
  opts: TimeBoundOptions,
): WindowEditorSource & { discardDrafts: () => void } {
  // Through refs, because the debounce fires long after the render that
  // scheduled it.
  const valueRef = useRef(value)
  valueRef.current = value
  const changeRef = useRef(onChange)
  changeRef.current = onChange
  const optsRef = useRef(opts)
  optsRef.current = opts
  const [drafts, setDrafts] = useState<Drafts>({})
  const draftsRef = useRef(drafts)
  const [errors, setErrors] = useState<Drafts>({})
  const timers = useRef(new Map<ScopeField, ReturnType<typeof setTimeout>>())
  const [at, setAt] = useState(minuteNow)

  // A Live bound's fields move with the clock, as the Posts editor's do.
  useEffect(() => {
    const id = setInterval(() => setAt(minuteNow()), REDRAW_MS)
    const pending = timers.current
    return () => {
      clearInterval(id)
      for (const timer of pending.values()) clearTimeout(timer)
    }
  }, [])

  const settle = useCallback((field: ScopeField, error: string | null) => {
    const timer = timers.current.get(field)
    if (timer) clearTimeout(timer)
    timers.current.delete(field)
    if (error) {
      setErrors((open) => ({ ...open, [field]: error }))
      return
    }
    const { [field]: _draft, ...rest } = draftsRef.current
    draftsRef.current = rest
    setDrafts(rest)
    setErrors(({ [field]: _error, ...others }) => others)
  }, [])

  /** Commit one field's value; the refusal, or `null`. */
  const apply = useCallback((field: ScopeField, v: number | null) => {
    const t = minuteNow()
    const r = applyBoundField(valueRef.current, field, v, optsRef.current, t)
    if (!r.ok) return r.error
    setAt(t)
    changeRef.current(r.value)
    return null
  }, [])

  const attempt = useCallback(
    (field: ScopeField, text: string) => {
      const parsed = parseBoundField(field, text, optsRef.current)
      settle(field, parsed.ok ? apply(field, parsed.value) : parsed.error)
    },
    [apply, settle],
  )

  return useMemo(
    () => ({
      mode: value.mode,
      setMode: (mode) => {
        const t = minuteNow()
        setAt(t)
        changeRef.current(switchTimeBoundMode(valueRef.current, mode, t))
      },
      applyValue: (field, v) => {
        const error = apply(field, v)
        settle(field, error)
        return error
      },
      draftText: (field) => drafts[field] ?? boundFieldText(value, field, at),
      setDraft: (field, text) => {
        draftsRef.current = { ...draftsRef.current, [field]: text }
        setDrafts(draftsRef.current)
        setErrors(({ [field]: _error, ...others }) => others)
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
      discardDrafts: () => {
        for (const timer of timers.current.values()) clearTimeout(timer)
        timers.current.clear()
        draftsRef.current = {}
        setDrafts({})
        setErrors({})
      },
      errors,
    }),
    [value, drafts, errors, at, apply, attempt, settle],
  )
}

function Hint({ opts }: { opts: TimeBoundOptions }) {
  if (!opts.openEnds && !opts.ahead) return null
  return (
    <p className="text-[11px] text-app-ink/50">
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
  noValue,
}: {
  value: TimeBound
  onChange: (next: TimeBound) => void
  opts: TimeBoundOptions
  /** The mode switch's accessible name: "Last post mode". */
  modeLabel: string
  noValue?: NoValue
}) {
  const source = useTimeBoundSource(value, onChange, opts)
  return (
    <WindowEditorSourceContext.Provider value={source}>
      <div className="space-y-2">
        <WindowEditor modeLabel={modeLabel} noValue={noValue} />
        {!noValue?.on && <Hint opts={opts} />}
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
  /** The line's accessible name and the sheet's title: "Logged". */
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
      summary={timeBoundSummary(value, minuteNow())}
      open={open}
      onOpenChange={(next) => {
        // As the Posts editor does: a valid draft commits on the way out,
        // what is left is incomplete or invalid and goes.
        if (!next) {
          for (const field of SCOPE_FIELDS) source.commitDraft(field)
          source.discardDrafts()
        }
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
