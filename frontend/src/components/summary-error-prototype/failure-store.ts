/**
 * PROTOTYPE, throw away. In-memory failure state for pending Summaries.
 *
 * `AIContext` records the real reason when a run leaves a Summary pending, so
 * a real failure shows its real message. `simulate` shows a fake one on every
 * pending Summary, so the state is reachable without breaking a Key. Retry is
 * a stub: it waits, then fails again or "succeeds" as `nextRetry` says. A
 * reload forgets everything.
 */
import { useSyncExternalStore } from "react"

export type Failure = { error: string; attempts: number; at: number }

const SAMPLE_ERRORS = [
  "The AI provider failed: 429 RESOURCE_EXHAUSTED. You exceeded your current quota, please check your plan and billing details.",
  "The AI provider failed: the request timed out after 120 s.",
  "The AI provider failed: 401 Incorrect API key provided.",
  "The model returned an empty response.",
]

type State = {
  failures: Record<string, Failure>
  retrying: Record<string, boolean>
  simulate: boolean
  nextRetry: "fail" | "succeed"
  /** A run that failed before its pending Summary was kept (no id to hang it on). */
  startFailure: { error: string; at: number } | null
}

let state: State = {
  failures: {},
  retrying: {},
  simulate: true,
  nextRetry: "fail",
  startFailure: null,
}
const listeners = new Set<() => void>()

function set(patch: Partial<State>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function useFailureStore() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

export function recordFailure(id: string, error: string) {
  const prev = state.failures[id]
  set({
    failures: {
      ...state.failures,
      [id]: { error, attempts: (prev?.attempts ?? 0) + 1, at: Date.now() },
    },
  })
}

/** The failure to show for a pending Summary, real first, then simulated. */
export function failureFor(s: State, id: string): Failure | undefined {
  if (s.failures[id]) return s.failures[id]
  if (s.simulate)
    return { error: SAMPLE_ERRORS[0], attempts: 1, at: Date.now() - 90_000 }
}

export function setSimulate(simulate: boolean) {
  set({ simulate })
}

export function setNextRetry(nextRetry: State["nextRetry"]) {
  set({ nextRetry })
}

/** Stubbed retry: no request, no provider spend, no write. */
export async function stubRetry(id: string): Promise<boolean> {
  set({ retrying: { ...state.retrying, [id]: true } })
  await new Promise((r) => setTimeout(r, 1500))
  const prev = failureFor(state, id)
  const ok = state.nextRetry === "succeed"
  const failures = { ...state.failures }
  if (ok) delete failures[id]
  else {
    const attempts = (prev?.attempts ?? 0) + 1
    failures[id] = {
      error: SAMPLE_ERRORS[attempts % SAMPLE_ERRORS.length],
      attempts,
      at: Date.now(),
    }
  }
  // A success clears the simulated failure too, or it would reappear.
  set({
    failures,
    retrying: { ...state.retrying, [id]: false },
    simulate: ok ? false : state.simulate,
  })
  return ok
}

export function recordStartFailure(error: string | null) {
  set({ startFailure: error ? { error, at: Date.now() } : null })
}

export const FAKE_START_ERROR =
  "The selected posts are ~365,307 tokens, over the 200,000-token limit for a single prompt. Narrow the channel selection or date range, or deselect some Posts."
