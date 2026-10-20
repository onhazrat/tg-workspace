import { createFileRoute } from "@tanstack/react-router"

import { redirectToSettings } from "./-settings-landing"

/**
 * The template's admin page (Users, Quotas) is the Settings tab's Users
 * panel under Operator now (SET-01, SET-02).
 */
export const Route = createFileRoute("/_tg/admin")({
  beforeLoad: ({ location }) =>
    redirectToSettings(location.searchStr, "operator.deployment.users"),
})
