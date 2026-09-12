/**
 * The Analysis-window controller (AW-03).
 *
 * Scope used to sit in `UIContext` beside the rate-limit flag and the history
 * search box, as two `useState` numbers with three setters that repaired each
 * other. It has its own module now for the reason the ticket gives: it is a
 * state machine with propagation rules, drafts, validation and a clock, and
 * none of that belongs in a bag of unrelated flags.
 *
 * This file is the React half. Every rule lives in `lib/scope/window.ts`, which
 * reads no clock and touches no React, so the whole temporal matrix is testable
 * by passing a number. What is here is the three things that need a component
 * tree: the minute each commit is judged against, the per-field drafts, and
 * persistence.
 */

import type React from "react"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { floorToMinute, MINUTE_MS, serverNow } from "@/lib/analysis-window"
import {
  applyField,
  fieldText,
  fixedRange,
  formatWindowSummary,
  loadWindow,
  parseField,
  resolveWindow,
  retireLegacyWindow,
  type ScopeField,
  saveWindow,
  switchMode,
  type WindowMode,
  type WindowState,
} from "@/lib/scope/window"

/** How long a typed field waits for the next keystroke before committing. */
export const DRAFT_COMMIT_MS = 400

export interface ScopeContextType {
  /** The chosen mode. Never inferred from the values. */
  mode: WindowMode
  /** Exact boundaries of the current window, half-open: `[startDate, endDate)`. */
  startDate: number
  endDate: number
  durationMs: number
  endGapMs: number
  /** The minute every derived value is resolved against. */
  minuteNow: number
  /**
   * The canonical window — what Live and Fixed each *are*, not what they
   * currently resolve to.
   *
   * This is what a server-backed Posts query is keyed on. A Live window's
   * boundaries move every minute; its identity does not, so keying on this
   * keeps the infinite feed's loaded pages across a tick and lets
   * {@link ScopeContextType.liveTick} refresh them in place.
   */
  windowKey: WindowState
  /**
   * Bumped whenever a Live window has moved and what it selects may have
   * changed: each synchronised minute boundary, and on regaining focus.
   *
   * Never bumped in Fixed mode, because a Fixed window does not move.
   */
  liveTick: number
  /** `Live · 1d 10h ago → 30m ago (1d 9h 30m)`. */
  summary: string

  setMode: (mode: WindowMode) => void
  /** Replace the window with an exact pair — a restored Scope, not a typed one. */
  setFixedRange: (start: number, end: number) => void
  /**
   * Commit one field directly: an exact instant for `start`/`end`, elapsed
   * milliseconds for `duration`/`endGap`. Returns the refusal, or `null`.
   *
   * For a control that produces a value rather than text — a picker, a preset.
   * A typed field goes through {@link ScopeContextType.setDraft} instead, which
   * is the same commit with a debounce and a draft in front of it.
   */
  applyValue: (field: ScopeField, value: number) => string | null

  /** What a field shows: its draft while one is open, else the committed value. */
  draftText: (field: ScopeField) => string
  /** Record a keystroke. Commits by itself after {@link DRAFT_COMMIT_MS}. */
  setDraft: (field: ScopeField, text: string) => void
  /** Commit now — Enter, or blur. */
  commitDraft: (field: ScopeField) => void
  /** Throw every open draft away; the committed window is untouched. */
  discardDrafts: () => void
  errors: Partial<Record<ScopeField, string>>
}

const ScopeContext = createContext<ScopeContextType | undefined>(undefined)

type Drafts = Partial<Record<ScopeField, string>>

export const ScopeProvider: React.FC<{
  children: ReactNode
  /**
   * The current *instant*, injected. Defaults to the server's, estimated —
   * never this browser's own, so a skewed laptop cannot change what a window
   * means. Tests pass a fake one and drive time by hand.
   *
   * An instant rather than the minute it falls in, because the live timer has
   * to land on the boundary: how long the current minute has left is
   * `MINUTE_MS - (now % MINUTE_MS)`, and a clock that has already floored
   * cannot answer it. Everything else here floors on the way in.
   */
  clock?: () => number
}> = ({ children, clock = serverNow }) => {
  const clockRef = useRef(clock)
  clockRef.current = clock

  const readMinute = useCallback(() => floorToMinute(clockRef.current()), [])

  const [minuteNow, setMinuteNow] = useState(() => floorToMinute(clock()))
  const [liveTick, setLiveTick] = useState(0)
  const [state, setState] = useState<WindowState>(() =>
    loadWindow(floorToMinute(clock())),
  )
  const [drafts, setDrafts] = useState<Drafts>({})
  const [errors, setErrors] = useState<Drafts>({})
  const timers = useRef(new Map<ScopeField, ReturnType<typeof setTimeout>>())
  const draftsRef = useRef<Drafts>({})

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  }, [])

  const resolved = useMemo(
    () => resolveWindow(state, minuteNow),
    [state, minuteNow],
  )

  /*
   * The one timer that makes a Live window live (AW-04).
   *
   * It is here, and only here. Every surface that draws an "ago" reads
   * `minuteNow` from this context, so the labels across the application move
   * together on one timer rather than each arming its own. What it must *not*
   * do is move the query key: `windowKey` is what a Posts query is keyed on and
   * a Live window's identity does not change on a tick, so the feed keeps the
   * pages it has already loaded and `liveTick` refreshes them in place.
   *
   * The delay is measured against the server's instant rather than this
   * browser's, so a tick lands on the minute the server will resolve against.
   * Fixed mode arms nothing: a window that does not move has nothing to
   * refresh.
   */
  useEffect(() => {
    if (state.mode !== "live") return

    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false

    const bump = () => {
      setMinuteNow(readMinute())
      setLiveTick((tick) => tick + 1)
    }

    const arm = () => {
      clearTimeout(timer)
      timer = undefined
      // Suspended while the tab is hidden: nobody is reading the labels and
      // nothing is on screen to refresh. Coming back is what catches it up.
      if (stopped || document.hidden) return
      const now = clockRef.current()
      const remaining =
        MINUTE_MS - (((now % MINUTE_MS) + MINUTE_MS) % MINUTE_MS)
      timer = setTimeout(() => {
        bump()
        arm()
      }, remaining)
    }

    // `main.tsx` re-reads the server clock on this same event, so by the time a
    // later tick is armed the offset is the fresh one. This half does not wait
    // for that round trip: a tab that has been away for an hour is stale the
    // moment it comes back, and a refresh that waits on a fetch is a refresh
    // somebody watches happen.
    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timer)
        timer = undefined
        return
      }
      bump()
      arm()
    }

    arm()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [state.mode, readMinute])

  const commit = useCallback((next: WindowState, minute: number) => {
    setState(next)
    // The minute the commit was judged against becomes the minute the four
    // fields are drawn against, so an edit never renders itself relative to a
    // minute that has already passed.
    setMinuteNow(minute)
    saveWindow(next)
  }, [])

  const clearDraft = useCallback((field: ScopeField) => {
    const timer = timers.current.get(field)
    if (timer) clearTimeout(timer)
    timers.current.delete(field)
    const { [field]: _dropped, ...rest } = draftsRef.current
    draftsRef.current = rest
    setDrafts(rest)
    setErrors((open) => {
      const { [field]: _alsoDropped, ...others } = open
      return others
    })
  }, [])

  /**
   * Try a typed field against the window as it stands *now*.
   *
   * Read through refs rather than closed over, because the 400 ms timer fires
   * long after the render that scheduled it and the minute will have moved.
   */
  const stateRef = useRef(state)
  stateRef.current = state

  // StrictMode double-invokes the `useState` initialiser above and keeps the
  // *second* result, so the pre-AW-03 keys cannot be consumed there — the first
  // pass would eat them and hand its answer to a discarded render. Retiring
  // them from an effect means the migration happens once, after a render that
  // actually stuck.
  useEffect(() => {
    retireLegacyWindow(stateRef.current)
  }, [])

  const attempt = useCallback(
    (field: ScopeField, text: string) => {
      const minute = readMinute()
      const current = stateRef.current
      const parsed = parseField(current.mode, minute, field, text)
      if (!parsed.ok) {
        setErrors((open) => ({ ...open, [field]: parsed.error }))
        return
      }
      const applied = applyField(current, minute, field, parsed.value)
      if (!applied.ok) {
        setErrors((open) => ({ ...open, [field]: applied.error }))
        return
      }
      commit(applied.state, minute)
      clearDraft(field)
    },
    [commit, clearDraft, readMinute],
  )

  const applyValue = useCallback(
    (field: ScopeField, value: number) => {
      const minute = readMinute()
      const applied = applyField(stateRef.current, minute, field, value)
      if (!applied.ok) {
        // Into the field's own error, not only the return value: a refusal has
        // to be readable beside the control that caused it, or a later success
        // elsewhere clears the message while the stale value is still on screen.
        setErrors((open) => ({ ...open, [field]: applied.error }))
        return applied.error
      }
      commit(applied.state, minute)
      clearDraft(field)
      return null
    },
    [commit, clearDraft, readMinute],
  )

  const setDraft = useCallback(
    (field: ScopeField, text: string) => {
      draftsRef.current = { ...draftsRef.current, [field]: text }
      setDrafts(draftsRef.current)
      setErrors((open) => {
        const { [field]: _dropped, ...rest } = open
        return rest
      })
      const existing = timers.current.get(field)
      if (existing) clearTimeout(existing)
      timers.current.set(
        field,
        setTimeout(() => attempt(field, text), DRAFT_COMMIT_MS),
      )
    },
    [attempt],
  )

  const commitDraft = useCallback(
    (field: ScopeField) => {
      // Through the ref, not the rendered `drafts`: Enter arrives in the same
      // event as the keystroke that opened the draft, before React has
      // re-rendered with it.
      const text = draftsRef.current[field]
      if (text === undefined) return
      const timer = timers.current.get(field)
      if (timer) clearTimeout(timer)
      timers.current.delete(field)
      attempt(field, text)
    },
    [attempt],
  )

  const discardDrafts = useCallback(() => {
    for (const timer of timers.current.values()) clearTimeout(timer)
    timers.current.clear()
    draftsRef.current = {}
    setDrafts({})
    setErrors({})
  }, [])

  const draftText = useCallback(
    (field: ScopeField) =>
      drafts[field] ?? fieldText(resolved, minuteNow, field),
    [drafts, resolved, minuteNow],
  )

  const value = useMemo<ScopeContextType>(
    () => ({
      mode: resolved.mode,
      startDate: resolved.start,
      endDate: resolved.end,
      durationMs: resolved.durationMs,
      endGapMs: resolved.endGapMs,
      minuteNow,
      windowKey: state,
      liveTick,
      summary: formatWindowSummary(resolved, minuteNow),
      // A mode change commits immediately and moves none of the four values.
      setMode: (next) => {
        const minute = readMinute()
        commit(switchMode(stateRef.current, minute, next), minute)
      },
      setFixedRange: (start, end) => {
        const minute = readMinute()
        commit(fixedRange(start, end, minute), minute)
      },
      applyValue,
      draftText,
      setDraft,
      commitDraft,
      discardDrafts,
      errors,
    }),
    [
      resolved,
      minuteNow,
      state,
      liveTick,
      errors,
      readMinute,
      commit,
      applyValue,
      draftText,
      setDraft,
      commitDraft,
      discardDrafts,
    ],
  )

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>
}

export const useScope = () => {
  const context = useContext(ScopeContext)
  if (context === undefined) {
    throw new Error("useScope must be used within a ScopeProvider")
  }
  return context
}
