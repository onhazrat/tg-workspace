import { createFileRoute, redirect } from "@tanstack/react-router"

/**
 * The template's account page (Profile, Password, Usage, Delete) is the
 * Settings tab's Account section now (SET-01).
 */
export const Route = createFileRoute("/_tg/settings")({
  beforeLoad: () => {
    throw redirect({ href: "/?tab=settings&section=account", replace: true })
  },
})
