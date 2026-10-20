import { describe, expect, test } from "bun:test"
import { isRedirect } from "@tanstack/react-router"

import { Route as Admin } from "./admin"
import { Route as Settings } from "./settings"
import { Route as Summarizer } from "./summarizer"
import { Route as Workspace } from "./workspace"

/**
 * The old addresses, called through their gates with no router: each one
 * throws a redirect, and the href it names is where a bookmark lands.
 */
function landing(route: { options: unknown }, searchStr: string): string {
  const beforeLoad = (
    route.options as {
      beforeLoad: (ctx: { location: { searchStr: string } }) => void
    }
  ).beforeLoad
  try {
    beforeLoad({ location: { searchStr } })
  } catch (err) {
    if (isRedirect(err)) return String(err.options.href)
    throw err
  }
  return "no redirect"
}

describe("old addresses land in the workspace at /", () => {
  test("/workspace keeps its query string", () => {
    expect(landing(Workspace, "?tab=posts&summary=s1")).toBe(
      "/?tab=posts&summary=s1",
    )
  })

  test("/summarizer keeps its query string", () => {
    expect(landing(Summarizer, "?tab=chat")).toBe("/?tab=chat")
  })

  test("/settings opens Settings on Account › Profile", () => {
    expect(landing(Settings, "")).toBe(
      "/?tab=settings&setting=account.yours.profile",
    )
  })

  test("/admin opens Settings on Operator › Users", () => {
    expect(landing(Admin, "")).toBe(
      "/?tab=settings&setting=operator.deployment.users",
    )
  })

  test("/settings and /admin keep their query string", () => {
    expect(landing(Settings, "?ref=mail")).toBe(
      "/?ref=mail&tab=settings&setting=account.yours.profile",
    )
    expect(landing(Admin, "?q=bob")).toBe(
      "/?q=bob&tab=settings&setting=operator.deployment.users",
    )
  })

  test("an old ?section= link opens its section, not the default", () => {
    expect(landing(Settings, "?section=sync")).toBe(
      "/?section=sync&tab=settings",
    )
  })
})
