import { createFileRoute, redirect } from "@tanstack/react-router"

/** PROTOTYPE: /settings (Profile, Password, Usage, Delete) is the Account part of Settings now. */
export const Route = createFileRoute("/_tg/settings")({
  beforeLoad: () => {
    throw redirect({ href: "/?tab=settings&setting=account.yours.profile", replace: true })
  },
})
