import { useQueryClient } from "@tanstack/react-query"

import { viewAsStartViewAs } from "@/client"
import {
  enterViewAs,
  exitViewAs,
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

  /** Put the session down and go back to the Owner's own account. */
  const stop = (): void => {
    exitViewAs()
    queryClient.clear()
    window.location.href = "/admin"
  }

  return { claims, isViewingAs: claims !== null, start, stop }
}

export default useViewAs
