import { createFileRoute, redirect } from "@tanstack/react-router"

/** PROTOTYPE: /admin (Users, Quotas) is the Admin part of Settings now. */
export const Route = createFileRoute("/_tg/admin")({
  beforeLoad: () => {
    throw redirect({ href: "/?tab=settings&setting=admin", replace: true })
  },
})
