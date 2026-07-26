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
    expect(VALID_SETTINGS_SECTIONS).toContain("network-telemetry")
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
    expect(normalizeSettingsSection("db")).toBe("data")
    expect(normalizeSettingsSection("data-management")).toBe("data")
    expect(normalizeSettingsSection("network-security")).toBe("network")
    expect(normalizeSettingsSection("ai-models")).toBe("ai")
    expect(normalizeSettingsSection("telemetry")).toBe("network-telemetry")
  })

  test("parentTocId links leaves to parents", () => {
    expect(parentTocId("setting-groups")).toBe("channels-sync")
    expect(parentTocId("proxy")).toBe("network")
    expect(parentTocId("tor")).toBe("network")
    expect(parentTocId("retention")).toBe("data")
    expect(parentTocId("diagnostics")).toBe("tools")
    expect(parentTocId("network-telemetry")).toBe("tools")
    expect(parentTocId("network")).toBeNull()
    expect(parentTocId("commonly-used")).toBeNull()
  })

  test("findTocNode resolves nested labels", () => {
    expect(findTocNode("setting-groups")?.label).toBe("Setting Groups")
    expect(findTocNode("proxy")?.label).toBe("Proxy")
    expect(findTocNode("network-telemetry")?.label).toBe("Network Telemetry")
    expect(findTocNode("missing" as never)).toBeUndefined()
  })

  test("tools children include diagnostics and network telemetry as siblings", () => {
    const tools = findTocNode("tools")
    expect(tools?.children?.map((c) => c.id)).toEqual([
      "diagnostics",
      "network-telemetry",
      "runtime-config",
    ])
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
