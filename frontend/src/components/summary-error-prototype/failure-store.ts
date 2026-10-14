/**
 * PROTOTYPE, throw away. In-memory failure history for Summaries.
 *
 * Each pending Summary keeps every failed attempt (error, model, time), oldest
 * first. A Generate that failed before any Summary was saved has no id, so its
 * attempts live under `START`. `AIContext` records real failures; `simulate`
 * gives every pending Summary a fake first failure so the state is reachable.
 * Retry is a stub: it waits, then fails again or "succeeds" as `nextRetry`
 * says. A reload forgets everything.
 */
import { useSyncExternalStore } from "react"

export type Attempt = { error: string; model: string; at: number }

/** The key for a Generate that failed before its Summary was kept. */
export const START = "__start__"

const SAMPLE_ERRORS = [
  "The AI provider failed: 429 RESOURCE_EXHAUSTED. You exceeded your current quota, please check your plan and billing details.",
  "The AI provider failed: the request timed out after 120 s.",
  "The AI provider failed: 401 Incorrect API key provided.",
  "The model returned an empty response.",
]
export const FAKE_START_ERROR =
  "The selected posts are ~365,307 tokens, over the 200,000-token limit for a single prompt. Narrow the channel selection or date range, or deselect some Posts."

type State = {
  failures: Record<string, Attempt[]>
  retrying: Record<string, boolean>
  simulate: boolean
  nextRetry: "fail" | "succeed"
}

let state: State = {
  failures: {},
  retrying: {},
  simulate: true,
  nextRetry: "fail",
}
const listeners = new Set<() => void>()
const SIMULATED_AT = Date.now() - 90_000

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

export function recordFailure(id: string, error: string, model: string) {
  const prev = state.failures[id] ?? []
  set({
    failures: {
      ...state.failures,
      [id]: [...prev, { error, model, at: Date.now() }],
    },
  })
}

export function clearFailures(id: string) {
  if (!state.failures[id]) return
  const failures = { ...state.failures }
  delete failures[id]
  set({ failures })
}

/** The attempts to show, real first, then the simulated first failure. */
export function attemptsFor(
  s: State,
  id: string,
  model: string,
): Attempt[] | undefined {
  if (s.failures[id]) return s.failures[id]
  if (s.simulate && id !== START)
    return [{ error: SAMPLE_ERRORS[0], model, at: SIMULATED_AT }]
}

export function setSimulate(simulate: boolean) {
  set({ simulate })
}

export function setNextRetry(nextRetry: State["nextRetry"]) {
  set({ nextRetry })
}

/**
 * Stubbed retry with `model`: no request, no provider spend, no write. `shown`
 * is what the page displays, so a simulated first failure joins the history.
 */
export async function stubRetry(
  id: string,
  model: string,
  shown: Attempt[],
): Promise<boolean> {
  set({ retrying: { ...state.retrying, [id]: true } })
  await new Promise((r) => setTimeout(r, 1500))
  const ok = state.nextRetry === "succeed"
  const failures = { ...state.failures }
  if (ok) delete failures[id]
  else
    failures[id] = [
      ...shown,
      {
        error:
          id === START
            ? (shown.at(-1)?.error ?? FAKE_START_ERROR)
            : SAMPLE_ERRORS[shown.length % SAMPLE_ERRORS.length],
        model,
        at: Date.now(),
      },
    ]
  // A success clears the simulated failure too, or it would reappear.
  set({
    failures,
    retrying: { ...state.retrying, [id]: false },
    simulate: ok && id !== START ? false : state.simulate,
  })
  return ok
}
