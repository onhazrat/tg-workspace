/**
 * What an empty Discover state's buttons do. Each button is the one way out of
 * a dead end, so one wired to the wrong handler (or to none) leaves somebody
 * clicking a button that silently does something else.
 */
import { describe, expect, test } from "bun:test"
import {
  type DiscoveryQuickAction,
  runDiscoveryQuickAction,
} from "./discover-empty-state"

/** Runs one action and returns every handler call it made. */
function run(action: DiscoveryQuickAction): string[] {
  const calls: string[] = []
  runDiscoveryQuickAction(action, {
    setForwardedFilter: (value) => calls.push(`filter:${value}`),
    goToTab: (tab) => calls.push(`tab:${tab}`),
    enableAllSignals: () => calls.push("signals"),
    resetCandidateFilters: () => calls.push("reset"),
  })
  return calls
}

describe("runDiscoveryQuickAction", () => {
  test("each action reaches its own handler and no other", () => {
    expect(run({ type: "set_forwarded_filter", value: "all" })).toEqual([
      "filter:all",
    ])
    expect(run({ type: "go_to_tab", tab: "posts" })).toEqual(["tab:posts"])
    expect(run({ type: "enable_all_signals" })).toEqual(["signals"])
    expect(run({ type: "reset_candidate_filters" })).toEqual(["reset"])
  })
})
