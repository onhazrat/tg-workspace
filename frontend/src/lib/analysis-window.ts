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

/** Refresh the estimate. Failure leaves the last good offset in place. */
export async function syncServerClock(): Promise<void> {
  try {
    const { now } = await utilsServerTime()
    offsetMs = now - Date.now()
  } catch {
    // A clock estimate is a nicety; nothing here is worth an error surface.
  }
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
export function fixedWindow(
  startDate?: number,
  endDate?: number,
): AnalysisWindowInput | undefined {
  if (startDate == null && endDate == null) return undefined

  const minute = serverMinuteStart()
  const start = floorToMinute(startDate ?? 0)
  const end = Math.min(floorToMinute(endDate ?? serverNow()), minute)

  return { mode: "fixed", start, end }
}
