import { Eye } from "lucide-react"
import { useEffect } from "react"

import { Button } from "@/components/ui/button"
import useViewAs from "@/hooks/useViewAs"

/** Kept in step with the `h-10` below; `index.css` says why it is needed. */
const RIBBON_HEIGHT = "2.5rem"

/**
 * The unmissable ribbon naming the account being viewed (ticket 26).
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
 * Destructive colouring on purpose. This is not information; it is a mode the
 * app is in, and the only other thing painted that colour is a Budget that has
 * stopped work entirely.
 */
export default function ViewAsRibbon() {
  const { claims, stop } = useViewAs()
  const active = claims !== null

  // Before the early return, so the variable is cleared when the session ends.
  useEffect(() => {
    const root = document.documentElement
    if (active) root.style.setProperty("--view-as-offset", RIBBON_HEIGHT)
    else root.style.removeProperty("--view-as-offset")
    return () => {
      root.style.removeProperty("--view-as-offset")
    }
  }, [active])

  if (claims === null) return null

  return (
    <div
      data-testid="view-as-ribbon"
      className="sticky top-0 z-50 flex h-10 shrink-0 items-center justify-center gap-3 bg-destructive px-4 text-sm font-medium text-white shadow-md"
    >
      <Eye className="size-4 shrink-0" />
      <span className="truncate">
        Viewing as <strong>{claims.subjectEmail}</strong> — read-only. Signed in
        as {claims.actorEmail}.
      </span>
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
