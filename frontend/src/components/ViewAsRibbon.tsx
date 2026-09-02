import { Eye, Pencil } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import useCustomToast from "@/hooks/useCustomToast"
import useViewAs from "@/hooks/useViewAs"
import { handleError } from "@/utils"

/** Kept in step with the `h-10` below; `index.css` says why it is needed. */
const RIBBON_HEIGHT = "2.5rem"

/**
 * The lifetimes offered for an elevation (ticket 27).
 *
 * A short menu rather than a number field: the server bounds the value anyway,
 * and a free-text minute count invites the Owner to type the maximum every
 * time — which is exactly what "chosen per elevation" is meant to stop. The
 * options are the three shapes the work actually takes, and the first is the
 * default because most of them are the first.
 *
 * Kept at or below `VIEW_AS_ELEVATED_MAX_MINUTES` (15); the server answers 422
 * for anything above it, so a drift here is a visible refusal rather than a
 * silently longer session.
 */
const ELEVATION_MINUTES = [5, 10, 15] as const

/**
 * The unmissable ribbon naming the account being viewed (ticket 26, 27).
 *
 * **Mounted at the router root, not in the shell.** It was in `_layout` first,
 * and that was wrong in the way that matters: `/summarizer` lives under `_tg`,
 * a separate branch that renders a bare `Outlet`, so the ribbon was absent from
 * the one screen a reported problem is usually about. A View-as session is a
 * property of the browser rather than of a route subtree, so it belongs where
 * every route can see it — `/login` included, where a leftover session is worth
 * knowing about.
 *
 * **Sticky rather than fixed**, and the difference is the whole layout. Fixed
 * would leave it hovering over the sidebar and the page header. Sticky takes a
 * row of its own above everything and *also* stays at the top of the viewport
 * while the page scrolls, which is what "unmissable" means for somebody who
 * spends the session scrolled into a post feed. The row it takes is why
 * `--view-as-offset` exists: two roots underneath declare a full-viewport
 * height and have to subtract it.
 *
 * It survives a reload because it is driven by a claim in the token rather than
 * by state — the spec's own decision. There is nothing to rehydrate and no
 * request to wait for, so it is on screen in the first paint rather than after
 * `/users/me` resolves, which is exactly the window in which somebody would
 * otherwise mistake the account for their own.
 *
 * **Elevated says so, in different words and a different colour.** The two
 * modes are not degrees of the same thing: in one the app cannot change
 * anything, and in the other every click writes to somebody else's account
 * under their name. A ribbon that read "viewing as X" for both would be at its
 * least informative in the mode that needs it most, so the elevated one names
 * the mode first, carries a pencil rather than an eye, and drops the offer to
 * elevate that the read-only one shows.
 *
 * Destructive colouring on purpose. This is not information; it is a mode the
 * app is in, and the only other thing painted that colour is a Budget that has
 * stopped work entirely.
 *
 * **An elevated session ends itself at `exp`, and that is not tidiness.**
 * `activeToken` falls back to the Owner's own token the moment the View-as one
 * expires — ticket 26's fix for a login loop, and exactly right while a session
 * could only read. Once it can write, the same fallback is a hazard: an Owner
 * still looking at a ribbon that says "Acting as them" clicks Save a minute
 * past expiry, the request goes out as the *Owner*, and a `PUT` with a new id
 * creates the row in the **Owner's own account** while the screen says
 * otherwise. So the elevated session is put down when it runs out, by the same
 * path as the Exit button. Read-only sessions keep ticket 26's behaviour
 * untouched: falling back silently costs nothing when nothing can be written.
 */
export default function ViewAsRibbon() {
  const { claims, isElevated, elevate, stop } = useViewAs()
  const { showErrorToast } = useCustomToast()
  const [elevating, setElevating] = useState(false)
  const active = claims !== null
  /** Milliseconds, or null when this is not a session that can write. */
  const elevatedUntil = isElevated && claims ? claims.expiresAt * 1000 : null

  // Before the early return, so the variable is cleared when the session ends.
  useEffect(() => {
    const root = document.documentElement
    if (active) root.style.setProperty("--view-as-offset", RIBBON_HEIGHT)
    else root.style.removeProperty("--view-as-offset")
    return () => {
      root.style.removeProperty("--view-as-offset")
    }
  }, [active])

  /*
   * The clock, not a render. `claims` is read once per render and nothing
   * re-renders at `exp`, so without this the ribbon keeps saying "Acting as"
   * long after the token behind it stopped being sent.
   *
   * `visibilitychange` is the other half: a background tab has its timers
   * throttled to minutes, which is long enough to miss the expiry entirely, and
   * coming back to the tab is exactly when somebody resumes editing.
   */
  useEffect(() => {
    if (!elevatedUntil) return
    const endIfExpired = () => {
      if (Date.now() >= elevatedUntil) stop()
    }
    const timer = window.setTimeout(endIfExpired, elevatedUntil - Date.now())
    document.addEventListener("visibilitychange", endIfExpired)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener("visibilitychange", endIfExpired)
    }
  }, [elevatedUntil, stop])

  if (claims === null) return null

  const onElevate = (minutes: number) => {
    setElevating(true)
    elevate(claims.subjectUserId, minutes).catch((error: unknown) => {
      // Only reached when the exchange is refused — a successful one navigates
      // away. The commonest refusal is a target who holds a permission, which
      // is a decision the Owner cannot argue with and has to be told about.
      setElevating(false)
      handleError.call(showErrorToast, error)
    })
  }

  return (
    <div
      data-testid="view-as-ribbon"
      data-view-as-mode={claims.mode}
      className={`sticky top-0 z-50 flex h-10 shrink-0 items-center justify-center gap-3 px-4 text-sm font-medium text-white shadow-md ${
        isElevated ? "bg-amber-600" : "bg-destructive"
      }`}
    >
      {isElevated ? (
        <Pencil className="size-4 shrink-0" />
      ) : (
        <Eye className="size-4 shrink-0" />
      )}
      <span className="truncate">
        {isElevated ? (
          <>
            <strong>Acting as {claims.subjectEmail}</strong> — changes are saved
            to their account and recorded as yours. Signed in as{" "}
            {claims.actorEmail}.
          </>
        ) : (
          <>
            Viewing as <strong>{claims.subjectEmail}</strong> — read-only.
            Signed in as {claims.actorEmail}.
          </>
        )}
      </span>

      {!isElevated &&
        ELEVATION_MINUTES.map((minutes) => (
          <Button
            key={minutes}
            size="sm"
            variant="secondary"
            className="h-7 shrink-0"
            disabled={elevating}
            onClick={() => onElevate(minutes)}
            title={`Make changes on their behalf for ${minutes} minutes`}
          >
            {minutes === ELEVATION_MINUTES[0]
              ? `Make a change (${minutes}m)`
              : `${minutes}m`}
          </Button>
        ))}

      <Button
        size="sm"
        variant="secondary"
        className="h-7 shrink-0"
        onClick={stop}
      >
        Exit
      </Button>
    </div>
  )
}
