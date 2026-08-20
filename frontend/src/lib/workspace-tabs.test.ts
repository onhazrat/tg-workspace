import { describe, expect, it } from "bun:test"

import { VALID_TABS, WORKSPACE_TABS } from "@/constants"

import { visibleWorkspaceTabs } from "./workspace-tabs"

describe("visibleWorkspaceTabs", () => {
  it("shows everything when compact is off", () => {
    expect(visibleWorkspaceTabs(false, "summary")).toEqual(WORKSPACE_TABS)
  })

  it("hides the feature tabs when compact is on", () => {
    const ids = visibleWorkspaceTabs(true, "posts").map((tab) => tab.id)
    expect(ids).toEqual(["channels", "posts", "action", "history", "settings"])
  })

  /**
   * The case that makes compact mode usable rather than confusing: opening an
   * artifact from History lands on a hidden tab, and the nav has to say so.
   */
  it("keeps a hidden tab visible while it is the active one", () => {
    const ids = visibleWorkspaceTabs(true, "summary").map((tab) => tab.id)
    expect(ids).toContain("summary")
    expect(ids).not.toContain("tag")
  })

  it("drops the transient entry once you navigate away", () => {
    const onSummary = visibleWorkspaceTabs(true, "summary").map((t) => t.id)
    const onPosts = visibleWorkspaceTabs(true, "posts").map((t) => t.id)
    expect(onSummary).toContain("summary")
    expect(onPosts).not.toContain("summary")
  })

  it("never narrows what the router accepts", () => {
    // Hiding is about the nav. Every tab stays reachable by URL, or every deep
    // link and palette command breaks the moment the setting is flipped.
    for (const tab of WORKSPACE_TABS) {
      expect(VALID_TABS).toContain(tab.id)
    }
  })
})
