import { createFileRoute, redirect } from "@tanstack/react-router"

/**
 * The template's admin page (Users, Quotas) is the Settings tab's Users
 * panel under Operator now (SET-01, SET-02).
 */
export const Route = createFileRoute("/_tg/admin")({
  beforeLoad: () => {
    throw redirect({
      href: "/?tab=settings&setting=operator.deployment.users",
      replace: true,
    })
  },
})
