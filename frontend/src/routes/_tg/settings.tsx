import { createFileRoute } from "@tanstack/react-router"

import { redirectToSettings } from "./-settings-landing"

/**
 * The template's account page (Profile, Password, Usage, Delete) is the
 * Settings page's Account › Profile now (SET-01, SET-02).
 */
export const Route = createFileRoute("/_tg/settings")({
  beforeLoad: ({ location }) =>
    redirectToSettings(location.searchStr, "account.yours.profile"),
})
