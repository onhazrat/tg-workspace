/**
 * The Analysis window the browser states, and the server's clock it states it
 * against (AW-02).
 *
 * Until this ticket a Scope carried two epoch milliseconds this browser
 * computed. The server took them as the intent, so a laptop whose clock ran
 * four minutes fast selected four minutes of Posts nobody asked for and the
 * stored Artifact recorded the skew as though it had been chosen.
 *
 * Now the request states Live or Fixed and the server resolves it. What stays
 * here is only what has to be drawn before a request is made — the collapsed
 * Posts summary, the editor's four fields, the timer that refreshes the feed on
 * each minute boundary — and for that this keeps an *estimate* of the server's
 * clock rather than reading its own.
 *
 * The estimate never decides anything. Every selection is resolved again,
 * server-side, at submission, so a stale offset makes a label repaint late and
 * cannot make a selection wrong. That is why this is a one-shot read with a
 * refresh on focus and not a round-trip-compensated time protocol.
 *
 * AW-03 builds the window controller on top of this. What lives here is the
 * clock and the wire shape, both of which the API layer needs before any
 * controller exists.
 */

import {
  type FixedAnalysisWindow,
  type LiveAnalysisWindow,
  utilsServerTime,
} from "@/client"

export const MINUTE_MS = 60_000

/** Either window form, told apart by `mode` — the server's discriminated union. */
export type AnalysisWindowInput = LiveAnalysisWindow | FixedAnalysisWindow

/**
 * Server time minus browser time, in milliseconds.
 *
 * Zero until the first successful sync, which is deliberately the old
 * behaviour: an unsynced clock is exactly the browser clock, so nothing is
 * worse than it was before this module existed.
 */
let offsetMs = 0

let pending: Promise<void> | null = null

/**
 * Refresh the estimate. Failure leaves the last good offset in place.
 *
 * At most one read per session, because `routes/_layout.tsx` awaits this in
 * `beforeLoad` and that re-runs on **every** navigation into the layout. Two
 * clocks drift by seconds a day, so a per-navigation round trip buys nothing
 * and costs a stall on every route change — the whole render waits, and an
 * offline browser waits out the full fetch timeout before the `catch` runs.
 *
 * `force` is how the `visibilitychange` listener gets a fresh read anyway: a
 * tab suspended for hours is the one case where this browser's own clock can
 * move without ticking, which is real drift rather than the imagined kind.
 */
export async function syncServerClock(force = false): Promise<void> {
  if (force) pending = null
  pending ??= (async () => {
    try {
      const { now } = await utilsServerTime()
      offsetMs = now - Date.now()
    } catch {
      // A clock estimate is a nicety; nothing here is worth an error surface.
      // Cleared so the next navigation retries rather than caching a failure.
      pending = null
    }
  })()
  return pending
}

/** The server's current instant, as well as this browser can tell. */
export function serverNow(): number {
  return Date.now() + offsetMs
}

/** The instant the server's current minute began. */
export function serverMinuteStart(): number {
  return floorToMinute(serverNow())
}

export function floorToMinute(ms: number): number {
  return ms - (((ms % MINUTE_MS) + MINUTE_MS) % MINUTE_MS)
}

/**
 * The Fixed form of a legacy `[startDate, endDate)` pair, or `undefined` for a
 * request that carries no window at all.
 *
 * Both bounds floor to the minute because the server does, so what is sent is
 * what will be used. The end is also held to the server's current minute: a
 * browser running ahead would otherwise post an end the server refuses as
 * being in the future, and turning every fast clock into a 422 is a worse
 * answer than the skew this ticket set out to remove.
 *
 * That is a clamp, and the spec refuses clamps — in the *editor*, where the
 * value is on screen and the person can be told. AW-03 puts the refusal there,
 * validating a typed end against the synchronised minute. This is the
 * conversion of a value the old UI produced from `Date.now()`, where there is
 * nothing to show anybody and no choice being made.
 */
/**
 * The shortest legal window containing `[start, end)`, given what the server
 * will accept: an end no later than its current minute, and a width of at
 * least one minute.
 *
 * Every workspace setter routes through this because all of them already
 * repaired a crossed range, and all of them repaired it by *collapsing* —
 * moving one boundary onto the other. That was an empty half-open window,
 * which the old server answered with a 200 and no posts. It is now a 422 on
 * every scoped request at once, and the pair is persisted, so one drag of the
 * End picker past the Start left the workspace refusing everything until
 * somebody thought to look at the date range.
 *
 * Holding the End and moving the Start is not a coin flip: it is the
 * propagation rule ADR-018 specifies for editing Start, arrived at a ticket
 * early.
 */
export function legalRange(start: number, end: number): [number, number] {
  const finalEnd = Math.min(end, serverMinuteStart())
  return [Math.min(start, finalEnd - MINUTE_MS), finalEnd]
}

export function fixedWindow(
  startDate?: number,
  endDate?: number,
): AnalysisWindowInput | undefined {
  // No widening here if the pair is crossed or zero-width. The server refuses
  // such a window by design (story 18), and a serialiser that quietly repaired
  // one would be inventing a selection with nothing on screen to admit to it.
  // Keeping the pair legal is `UIContext.legalRange`'s job, where there is a
  // person and a picker; `App.tsx` and `AIContext` handle the two cases that
  // do not come from the picker.
  if (startDate == null && endDate == null) return undefined

  const minute = serverMinuteStart()
  const start = floorToMinute(startDate ?? 0)
  const end = Math.min(floorToMinute(endDate ?? serverNow()), minute)

  return { mode: "fixed", start, end }
}
