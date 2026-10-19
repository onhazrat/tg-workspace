import { describe, expect, test } from "bun:test"
import {
  findTocNode,
  isCatalogBrowseSection,
  normalizeSettingsSection,
  parentTocId,
  SETTINGS_TOC,
  VALID_SETTINGS_SECTIONS,
} from "./toc"

describe("settings TOC", () => {
  test("includes hierarchical leaves used by URL section=", () => {
    expect(VALID_SETTINGS_SECTIONS).toContain("setting-groups")
    expect(VALID_SETTINGS_SECTIONS).toContain("proxy")
    expect(VALID_SETTINGS_SECTIONS).toContain("tor")
    expect(VALID_SETTINGS_SECTIONS).toContain("retention")
    expect(VALID_SETTINGS_SECTIONS).toContain("configuration")
  })

  // SET-01: the template's /settings and /admin pages land here.
  test("holds the account and users sections the template pages left", () => {
    expect(normalizeSettingsSection("account")).toBe("account")
    expect(normalizeSettingsSection("users")).toBe("users")
  })

  // SET-01: tools are not settings; they moved to the Tools tab.
  test("no longer lists the tools", () => {
    for (const tool of [
      "tools",
      "diagnostics",
      "network-telemetry",
      "quick-message",
      "table-sizes",
      "transfer",
      "query",
    ]) {
      expect(VALID_SETTINGS_SECTIONS).not.toContain(tool)
    }
  })

  // The TOC used to advertise a "danger" section that had no panel behind it —
  // selecting it rendered Table Sizes. It was removed rather than built, so a
  // bookmarked ?section=danger must degrade instead of resolving to the wrong page.
  test("no longer offers the never-built danger section", () => {
    expect(VALID_SETTINGS_SECTIONS).not.toContain("danger")
    expect(normalizeSettingsSection("danger")).toBe("commonly-used")
  })

  test("maps all legacy aliases", () => {
    expect(normalizeSettingsSection("sync")).toBe("channels-sync")
    expect(normalizeSettingsSection("scraping-sync")).toBe("channels-sync")
    expect(normalizeSettingsSection("db")).toBe("retention")
    expect(normalizeSettingsSection("data")).toBe("retention")
    expect(normalizeSettingsSection("data-management")).toBe("retention")
    expect(normalizeSettingsSection("network-security")).toBe("network")
    expect(normalizeSettingsSection("ai-models")).toBe("ai")
  })

  test("parentTocId links leaves to parents", () => {
    expect(parentTocId("setting-groups")).toBe("channels-sync")
    expect(parentTocId("proxy")).toBe("network")
    expect(parentTocId("tor")).toBe("network")
    expect(parentTocId("retention")).toBeNull()
    expect(parentTocId("configuration")).toBeNull()
    expect(parentTocId("network")).toBeNull()
    expect(parentTocId("commonly-used")).toBeNull()
  })

  test("findTocNode resolves nested labels", () => {
    expect(findTocNode("setting-groups")?.label).toBe("Setting Groups")
    expect(findTocNode("proxy")?.label).toBe("Proxy")
    expect(findTocNode("users")?.label).toBe("Users")
    expect(findTocNode("missing" as never)).toBeUndefined()
  })

  test("isCatalogBrowseSection covers curated + schema sections", () => {
    expect(isCatalogBrowseSection("commonly-used")).toBe(true)
    expect(isCatalogBrowseSection("appearance")).toBe(true)
    expect(isCatalogBrowseSection("channels-sync")).toBe(true)
    expect(isCatalogBrowseSection("ai")).toBe(true)
    expect(isCatalogBrowseSection("proxy")).toBe(false)
    expect(isCatalogBrowseSection("retention")).toBe(false)
  })

  test("SETTINGS_TOC top-level order matches IA", () => {
    expect(SETTINGS_TOC.map((n) => n.id)).toEqual([
      "commonly-used",
      "account",
      "appearance",
      "channels-sync",
      "ai",
      "network",
      "publishing",
      "retention",
      "users",
      "configuration",
    ])
  })
})
