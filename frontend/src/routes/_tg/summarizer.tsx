import { createFileRoute, redirect } from "@tanstack/react-router"

/**
 * Legacy path from when the product was only a summarizer.
 *
 * Bookmarks and shared links still land here; send them to `/workspace` with
 * the same query string so deep links (`?tab=`, `?summary=`, …) keep working.
 */
export const Route = createFileRoute("/_tg/summarizer")({
  beforeLoad: ({ location }) => {
    throw redirect({
      href: `/workspace${location.searchStr}`,
      replace: true,
    })
  },
})
