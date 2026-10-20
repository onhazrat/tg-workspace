import { describe, expect, test } from "bun:test"
import { validateWorkspaceSearch } from "./workspace-search"

describe("validateWorkspaceSearch", () => {
  test("an old Settings link to a tool opens the Tools tab", () => {
    for (const section of [
      "quick-message",
      "diagnostics",
      "network-telemetry",
      "table-sizes",
      "transfer",
      "query",
      "tools",
      "telemetry",
      "logs",
      "db",
      "data",
      "data-management",
    ]) {
      expect(validateWorkspaceSearch({ tab: "settings", section })).toEqual({
        tab: "tools",
      })
    }
    expect(
      validateWorkspaceSearch({ tab: "settings", section: "proxy" }),
    ).toEqual({ tab: "settings", section: "proxy" })
  })

  test("no tab, or one that does not exist, is Channels", () => {
    expect(validateWorkspaceSearch({})).toEqual({ tab: "channels" })
    expect(validateWorkspaceSearch({ tab: "nope" })).toEqual({
      tab: "channels",
    })
    expect(validateWorkspaceSearch({ tab: 3 })).toEqual({ tab: "channels" })
  })

  test("the Directory view's parameters are kept as text, the empty filter too", () => {
    // The router reads `?dirPage=2` as a number and `?dirFilter=` as "".
    expect(
      validateWorkspaceSearch({
        tab: "directory",
        dirFilter: "",
        dirPage: 2,
        dirSort: " reach ",
        dirKinds: "",
      }),
    ).toEqual({
      tab: "directory",
      dirFilter: "",
      dirPage: "2",
      dirSort: "reach",
    })
  })

  test("History's status filter is kept on History only, and only if known", () => {
    expect(
      validateWorkspaceSearch({ tab: "history", historyStatus: "failed" }),
    ).toEqual({ tab: "history", historyStatus: "failed" })
    expect(
      validateWorkspaceSearch({ tab: "history", historyStatus: "pending" }),
    ).toEqual({ tab: "history", historyStatus: "pending" })
    expect(
      validateWorkspaceSearch({ tab: "history", historyStatus: "broken" }),
    ).toEqual({ tab: "history" })
    expect(
      validateWorkspaceSearch({ tab: "posts", historyStatus: "failed" }),
    ).toEqual({ tab: "posts" })
  })

  test("a real tab is kept", () => {
    expect(validateWorkspaceSearch({ tab: "history" })).toEqual({
      tab: "history",
    })
  })

  test("the legacy network tab is the Network section and drops the rest", () => {
    expect(
      validateWorkspaceSearch({
        tab: "network",
        section: "ai",
        report: "r1",
      }),
    ).toEqual({ tab: "settings", section: "network" })
  })

  test("a section is trimmed, and blank or non-string ones are dropped", () => {
    // The Settings page maps an old section id to its topic (SET-02).
    expect(
      validateWorkspaceSearch({ tab: "settings", section: " network " })
        .section,
    ).toBe("network")
    expect("section" in validateWorkspaceSearch({ section: "" })).toBe(false)
    expect("section" in validateWorkspaceSearch({ section: 4 })).toBe(false)
  })

  test("every id param is trimmed, and blank or non-string ones are dropped", () => {
    // Each Artifact param is checked on its own tab, where it survives.
    const keys = [
      ["setting", "channels"],
      ["channelFilter", "channels"],
      ["settingGroup", "channels"],
      ["report", "discover"],
      ["summary", "summary"],
      ["chatSession", "chat"],
      ["tagRun", "tag"],
    ] as const
    for (const [key, tab] of keys) {
      expect(validateWorkspaceSearch({ tab, [key]: "  id-1 " })).toEqual({
        tab,
        [key]: "id-1",
      })
      expect(validateWorkspaceSearch({ tab, [key]: "   " })).toEqual({ tab })
      expect(validateWorkspaceSearch({ tab, [key]: 7 })).toEqual({ tab })
    }
  })

  test("an old channelGroup link is a one-Condition Channel filter (CTB-01)", () => {
    expect(
      validateWorkspaceSearch({ tab: "channels", channelGroup: " g-1 " }),
    ).toEqual({ tab: "channels", channelFilter: "group:g-1" })
    // The new parameter wins over the old one, and a blank old one is nothing.
    expect(
      validateWorkspaceSearch({
        channelGroup: "g-1",
        channelFilter: "tag:tech",
      }),
    ).toEqual({ tab: "channels", channelFilter: "tag:tech" })
    expect(validateWorkspaceSearch({ channelGroup: "  " })).toEqual({
      tab: "channels",
    })
  })

  test("only the active tab's Artifact param survives (TABS-01)", () => {
    expect(
      validateWorkspaceSearch({ tab: "posts", summary: "s", report: "r" }),
    ).toEqual({ tab: "posts" })
    expect(
      validateWorkspaceSearch({ tab: "summary", summary: "s", report: "r" }),
    ).toEqual({ tab: "summary", summary: "s" })
  })

  test("unknown params do not survive", () => {
    expect(validateWorkspaceSearch({ tab: "posts", junk: "x" })).toEqual({
      tab: "posts",
    })
  })
})
