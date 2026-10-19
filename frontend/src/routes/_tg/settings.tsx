import { createFileRoute, redirect } from "@tanstack/react-router"

/**
 * The template's account page (Profile, Password, Usage, Delete) is the
 * Settings page's Account › Profile now (SET-01, SET-02).
 */
export const Route = createFileRoute("/_tg/settings")({
  beforeLoad: () => {
    throw redirect({
      href: "/?tab=settings&setting=account.yours.profile",
      replace: true,
    })
  },
})
