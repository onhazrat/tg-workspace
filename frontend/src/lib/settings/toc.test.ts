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
    expect(VALID_SETTINGS_SECTIONS).toContain("diagnostics")
  })

  test("maps all legacy aliases", () => {
    expect(normalizeSettingsSection("sync")).toBe("channels-sync")
    expect(normalizeSettingsSection("scraping-sync")).toBe("channels-sync")
    expect(normalizeSettingsSection("db")).toBe("data")
    expect(normalizeSettingsSection("data-management")).toBe("data")
    expect(normalizeSettingsSection("network-security")).toBe("network")
    expect(normalizeSettingsSection("ai-models")).toBe("ai")
  })

  test("parentTocId links leaves to parents", () => {
    expect(parentTocId("setting-groups")).toBe("channels-sync")
    expect(parentTocId("proxy")).toBe("network")
    expect(parentTocId("tor")).toBe("network")
    expect(parentTocId("retention")).toBe("data")
    expect(parentTocId("network")).toBeNull()
    expect(parentTocId("commonly-used")).toBeNull()
  })

  test("findTocNode resolves nested labels", () => {
    expect(findTocNode("setting-groups")?.label).toBe("Setting Groups")
    expect(findTocNode("proxy")?.label).toBe("Proxy")
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
      "appearance",
      "channels-sync",
      "ai",
      "network",
      "publishing",
      "data",
      "tools",
    ])
  })
})
