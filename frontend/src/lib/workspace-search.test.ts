import { describe, expect, test } from "bun:test"
import { validateWorkspaceSearch } from "./workspace-search"

describe("validateWorkspaceSearch", () => {
  test("no tab, or one that does not exist, is Channels", () => {
    expect(validateWorkspaceSearch({})).toEqual({ tab: "channels" })
    expect(validateWorkspaceSearch({ tab: "nope" })).toEqual({
      tab: "channels",
    })
    expect(validateWorkspaceSearch({ tab: 3 })).toEqual({ tab: "channels" })
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

  test("a section is normalised, blank or unknown falls back", () => {
    expect(
      validateWorkspaceSearch({ tab: "settings", section: " network " })
        .section,
    ).toBe("network")
    expect(validateWorkspaceSearch({ section: "" }).section).toBe(
      "commonly-used",
    )
    expect(validateWorkspaceSearch({ section: "bogus" }).section).toBe(
      "commonly-used",
    )
    expect("section" in validateWorkspaceSearch({ section: 4 })).toBe(false)
  })

  test("every id param is trimmed, and blank or non-string ones are dropped", () => {
    const keys = [
      "setting",
      "channelGroup",
      "settingGroup",
      "report",
      "summary",
      "chatSession",
      "tagRun",
    ]
    for (const key of keys) {
      expect(validateWorkspaceSearch({ [key]: "  id-1 " })).toEqual({
        tab: "channels",
        [key]: "id-1",
      })
      expect(validateWorkspaceSearch({ [key]: "   " })).toEqual({
        tab: "channels",
      })
      expect(validateWorkspaceSearch({ [key]: 7 })).toEqual({
        tab: "channels",
      })
    }
  })

  test("unknown params do not survive", () => {
    expect(validateWorkspaceSearch({ tab: "posts", junk: "x" })).toEqual({
      tab: "posts",
    })
  })
})
