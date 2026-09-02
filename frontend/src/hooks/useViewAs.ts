import { useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"

import { viewAsElevateViewAs, viewAsStartViewAs } from "@/client"
import {
  enterViewAs,
  exitViewAs,
  ownerToken,
  VIEW_AS_ELEVATED,
  type ViewAsClaims,
  viewAsClaims,
} from "@/lib/storage/scoped"

/**
 * Starting, ending, and knowing about a View-as session (ticket 26).
 *
 * The session lives entirely in the token, so there is no context and nothing
 * to keep in sync — `viewAsClaims()` reads it off storage at render, which is
 * what makes the ribbon survive a reload with no state of its own.
 *
 * **Both transitions reload the page, deliberately.** Every query in the cache
 * belongs to whichever account was active, the browser-storage namespace moves
 * with the token (`lib/storage/scoped.ts`), and half the app reads settings in
 * a `useState` initialiser that only runs on mount. Re-rendering in place would
 * leave one person's channels and filters on screen under another person's
 * name — which is the exact confusion the unmissable ribbon exists to prevent.
 * A full reload is the cheap way to be certain, and it happens twice per
 * support investigation.
 *
 * `elevate` is ticket 27 and is deliberately **not** a flag on the session
 * already in hand: it is a second exchange authorised by the Owner's own
 * `access_token`, which the browser never replaced. That is what makes
 * self-escalation impossible — the server refuses every POST carrying a
 * View-as token, so a session cannot reach the route that would widen it, and
 * there is no hole in the read-only gate to rely on being right.
 */
export function useViewAs() {
  const queryClient = useQueryClient()
  const claims: ViewAsClaims | null = viewAsClaims()

  /** Begin looking at one account. Resolves only if the exchange is refused. */
  const start = async (userId: string): Promise<void> => {
    const session = await viewAsStartViewAs({ path: { user_id: userId } })
    enterViewAs(session.accessToken)
    queryClient.clear()
    window.location.href = "/"
  }

  /**
   * Trade the read-only look for a short session that may write.
   *
   * `minutes` is chosen at the call site because elevation is not one activity
   * with one shape — a stuck setting is seconds and walking somebody's import
   * is minutes. The server bounds it; passing nothing takes the deployment's
   * default.
   *
   * The returned token *replaces* `view_as_token`. The Owner's own token is
   * untouched, exactly as when the read-only session started, so exiting is
   * still one `removeItem` however the session was widened.
   */
  const elevate = async (userId: string, minutes?: number): Promise<void> => {
    // Sent with the Owner's **own** token, not the browser's active one. The
    // ribbon offers this from inside a read-only session, and the default
    // identity there is that session — which the server refuses, correctly and
    // by design, since a session that could widen itself would need no Owner at
    // all. `ownerToken` is the named exception to `activeToken`, and
    // `api/generated-client.ts` is what lets an explicit header through.
    const owner = ownerToken()
    const session = await viewAsElevateViewAs({
      path: { user_id: userId },
      query: minutes === undefined ? undefined : { minutes },
      headers: owner ? { Authorization: `Bearer ${owner}` } : undefined,
    })
    enterViewAs(session.accessToken)
    queryClient.clear()
    window.location.href = "/"
  }

  /**
   * Put the session down and go back to the Owner's own account.
   *
   * Memoised because `ViewAsRibbon` schedules it on a timer keyed by identity:
   * a new function every render would tear the timer down and rebuild it on
   * every render, which works but churns for no reason.
   */
  const stop = useCallback((): void => {
    exitViewAs()
    queryClient.clear()
    window.location.href = "/admin"
  }, [queryClient])

  return {
    claims,
    isViewingAs: claims !== null,
    isElevated: claims?.mode === VIEW_AS_ELEVATED,
    start,
    elevate,
    stop,
  }
}

export default useViewAs
