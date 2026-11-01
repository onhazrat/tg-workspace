/**
 * The window check kept live (WR-02, ADR-044). The server names the followed
 * Channels a sync just changed; the page asks the check for those alone and
 * merges their verdicts here. The browser sums the Scope's totals, never a
 * verdict. One stream per page, opened while anything listens; after a
 * reconnect every listener hears "all", so a change missed offline is asked
 * for once in full.
 */

import { streamChannelChanges } from "@/api"
import type { Verdict, WindowCheck } from "./window-check"

/** Some Channels' names, or every Channel after a reconnect. */
export type Change = string[] | "all"

/**
 * `check` with `fresh`'s verdicts in place of its own and the totals summed
 * again by the server's rules (`check_window`). A Channel `fresh` does not
 * answer for keeps its row, and none is added.
 */
export function merged(check: WindowCheck, fresh: WindowCheck): WindowCheck {
  const byName = new Map(fresh.channels.map((c) => [c.name, c]))
  const channels = check.channels.map((c) => byName.get(c.name) ?? c)
  const incomplete = channels.filter((c) => c.reasons.length)
  return {
    ...check,
    channels,
    heldPosts: channels.reduce((n, c) => n + c.heldPosts, 0),
    unprovenPosts: Math.round(
      incomplete.reduce((n, c) => n + c.unprovenPosts, 0),
    ),
    unprovenFloor: incomplete.some(
      (c: Verdict) =>
        c.pacePerHour == null && c.stretches.some((s) => s.kind !== "hole"),
    ),
  }
}

/** Which of `names` a change asks about. */
export const touched = (change: Change, names: readonly string[]) =>
  change === "all" ? [...names] : names.filter((n) => change.includes(n))

const RECONNECT_MS = 5_000
/**
 * How long the stream outlives its last listener, so a page that subscribes
 * again at once (a Live tick, a new selection) keeps the same connection.
 */
const CLOSE_AFTER_MS = 1_000
const listeners = new Set<(change: Change) => void>()
let open: AbortController | null = null

const emit = (change: Change) => {
  for (const listener of listeners) listener(change)
}

/**
 * Hear the stream until `signal`, reconnecting after `retryMs` whenever it
 * drops or ends; every open frame after the first is heard as "all".
 */
export async function listen(
  signal: AbortSignal,
  hear: (change: Change) => void,
  connect = streamChannelChanges,
  retryMs = RECONNECT_MS,
) {
  let opened = false
  while (!signal.aborted) {
    try {
      let first = true
      for await (const { names } of connect(signal)) {
        if (!first) hear(names)
        else if (opened) hear("all")
        first = false
        opened = true
      }
    } catch {
      /* dropped: reconnect below */
    }
    if (!signal.aborted)
      await new Promise((resolve) => setTimeout(resolve, retryMs))
  }
}

/** Hear every change while subscribed; answers the unsubscribe. */
export function onChannelChanges(listener: (change: Change) => void) {
  listeners.add(listener)
  if (!open) {
    open = new AbortController()
    void listen(open.signal, emit)
  }
  return () => {
    listeners.delete(listener)
    setTimeout(() => {
      if (listeners.size || !open) return
      open.abort()
      open = null
    }, CLOSE_AFTER_MS)
  }
}
