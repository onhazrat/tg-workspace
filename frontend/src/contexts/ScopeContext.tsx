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
import { serverMinuteStart } from "@/lib/analysis-window"
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
   * The current minute, injected. Defaults to the server's, estimated — never
   * this browser's own, so a skewed laptop cannot change what a window means.
   * Tests pass a fake one and drive time by hand.
   */
  clock?: () => number
}> = ({ children, clock = serverMinuteStart }) => {
  const clockRef = useRef(clock)
  clockRef.current = clock

  const [minuteNow, setMinuteNow] = useState(() => clock())
  const [state, setState] = useState<WindowState>(() => loadWindow(clock()))
  const [drafts, setDrafts] = useState<Drafts>({})
  const [errors, setErrors] = useState<Drafts>({})
  const timers = useRef(new Map<ScopeField, ReturnType<typeof setTimeout>>())
  const draftsRef = useRef<Drafts>({})

  /*
   * There is deliberately no timer here.
   *
   * A Live window's boundaries are what `queryKeys.postsFeed` and
   * `postsCounts` are built from, so re-resolving the minute on a tick does not
   * refresh the feed — it *remints the key*. The infinite query remounts at
   * page one, whatever the Account had scrolled past is gone, and a fresh cache
   * entry is minted every minute for every filter combination.
   *
   * Making a Live window move is AW-04's ticket, and the mechanism it needs is
   * invalidation of the key the feed already has, not a new one. The minute is
   * therefore re-read at mount and at each commit, which keeps the four fields
   * truthful the moment anybody acts on them, and left alone in between.
   */

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
      const minute = clockRef.current()
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
    [commit, clearDraft],
  )

  const applyValue = useCallback(
    (field: ScopeField, value: number) => {
      const minute = clockRef.current()
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
    [commit, clearDraft],
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
      summary: formatWindowSummary(resolved, minuteNow),
      // A mode change commits immediately and moves none of the four values.
      setMode: (next) => {
        const minute = clockRef.current()
        commit(switchMode(stateRef.current, minute, next), minute)
      },
      setFixedRange: (start, end) => {
        const minute = clockRef.current()
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
      errors,
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
