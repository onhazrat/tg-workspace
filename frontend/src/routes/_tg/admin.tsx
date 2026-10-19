import { createFileRoute, redirect } from "@tanstack/react-router"

/**
 * The template's admin page (Users, Quotas) is the Settings tab's Users
 * section now (SET-01).
 */
export const Route = createFileRoute("/_tg/admin")({
  beforeLoad: () => {
    throw redirect({ href: "/?tab=settings&section=users", replace: true })
  },
})
