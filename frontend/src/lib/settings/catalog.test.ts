import { describe, expect, test } from "bun:test"
import { settingValueChanged } from "@/components/settings/SettingRow"
import {
  COMMONLY_USED_SETTING_IDS,
  catalogEntriesForGroup,
  catalogKnobEntries,
  catalogPanelEntries,
  commonlyUsedEntries,
  getCatalogEntry,
  isSettingModified,
  SETTINGS_CATALOG,
  settingElementId,
  valuesEqual,
} from "./catalog"
import {
  parseSettingsQuery,
  searchSettings,
  suggestSettingsOperators,
} from "./search"
import { normalizeSettingsSection } from "./toc"

describe("settings catalog", () => {
  test("has unique ids", () => {
    const ids = SETTINGS_CATALOG.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("settingElementId matches deep-link DOM convention", () => {
    expect(settingElementId("proxyEnabled")).toBe("setting-proxyEnabled")
    expect(settingElementId("panel-retention")).toBe("setting-panel-retention")
  })

  test("commonly used ids resolve", () => {
    for (const id of COMMONLY_USED_SETTING_IDS) {
      expect(getCatalogEntry(id)).toBeDefined()
    }
    expect(commonlyUsedEntries()).toHaveLength(COMMONLY_USED_SETTING_IDS.length)
  })

  test("isSettingModified detects changes", () => {
    const entry = getCatalogEntry("proxyEnabled")!
    expect(isSettingModified(entry, false)).toBe(false)
    expect(isSettingModified(entry, true)).toBe(true)
    expect(settingValueChanged(entry, true)).toBe(true)
    expect(settingValueChanged(entry, false)).toBe(false)
  })

  test("isSettingModified is false for panel entries", () => {
    const panel = catalogPanelEntries()[0]!
    expect(isSettingModified(panel, "anything")).toBe(false)
  })

  test("valuesEqual handles primitives and objects", () => {
    expect(valuesEqual(1, 1)).toBe(true)
    expect(valuesEqual({ a: 1 }, { a: 1 })).toBe(true)
    expect(valuesEqual({ a: 1 }, { a: 2 })).toBe(false)
  })

  test("group helpers partition knobs vs panels", () => {
    expect(catalogKnobEntries().every((e) => e.control.kind !== "panel")).toBe(
      true,
    )
    expect(catalogPanelEntries().every((e) => e.control.kind === "panel")).toBe(
      true,
    )
    expect(catalogEntriesForGroup("network").length).toBeGreaterThan(0)
  })

  test("setting groups panel is registered", () => {
    const entry = getCatalogEntry("panel-setting-groups")
    expect(entry?.control.kind).toBe("panel")
    if (entry?.control.kind === "panel") {
      expect(entry.control.sectionId).toBe("setting-groups")
    }
  })

  test("diagnostics and network telemetry are separate panel targets", () => {
    const diagnostics = getCatalogEntry("panel-diagnostics")
    const telemetry = getCatalogEntry("panel-network-telemetry")
    expect(diagnostics?.control.kind).toBe("panel")
    expect(telemetry?.control.kind).toBe("panel")
    if (diagnostics?.control.kind === "panel") {
      expect(diagnostics.control.sectionId).toBe("diagnostics")
    }
    if (telemetry?.control.kind === "panel") {
      expect(telemetry.control.sectionId).toBe("network-telemetry")
    }
  })
})

describe("settings search", () => {
  test("empty query returns no hits (browse mode)", () => {
    expect(searchSettings("")).toEqual([])
    expect(searchSettings("   ")).toEqual([])
  })

  test("flattens matches across groups", () => {
    const hits = searchSettings("proxy")
    expect(hits.length).toBeGreaterThan(0)
    const groups = new Set(hits.map((h) => h.entry.group))
    expect(groups.has("network")).toBe(true)
  })

  test("LLM logs search lands on diagnostics panel", () => {
    const hits = searchSettings("LLM logs")
    expect(hits.some((h) => h.entry.id === "panel-diagnostics")).toBe(true)
    expect(hits.some((h) => h.entry.id === "panel-network-telemetry")).toBe(
      false,
    )
  })

  test("network telemetry search lands on telemetry panel", () => {
    const hits = searchSettings("network telemetry")
    expect(hits[0]?.entry.id).toBe("panel-network-telemetry")
  })

  test("parseSettingsQuery extracts operators", () => {
    const parsed = parseSettingsQuery("@modified @feature:ai temperature")
    expect(parsed.modifiedOnly).toBe(true)
    expect(parsed.feature).toBe("ai")
    expect(parsed.text).toBe("temperature")
  })

  test("@id filters to one entry", () => {
    const hits = searchSettings("@id:syncConcurrency")
    expect(hits).toHaveLength(1)
    expect(hits[0]?.entry.id).toBe("syncConcurrency")
  })

  test("@feature:ai scopes flatten results", () => {
    const hits = searchSettings("@feature:ai temperature")
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((h) => h.entry.group === "ai")).toBe(true)
  })

  test("@modified filters via isModified callback", () => {
    const hits = searchSettings("@modified", {
      isModified: (e) => e.id === "proxyEnabled",
    })
    expect(hits.every((h) => h.entry.id === "proxyEnabled")).toBe(true)
  })

  test("operator suggestions for @ fragment", () => {
    const suggestions = suggestSettingsOperators("@mod")
    expect(suggestions.some((s) => s.startsWith("@modified"))).toBe(true)
  })
})

describe("settings TOC aliases", () => {
  test("maps legacy section ids", () => {
    expect(normalizeSettingsSection("sync")).toBe("channels-sync")
    expect(normalizeSettingsSection("db")).toBe("data")
    expect(normalizeSettingsSection("appearance")).toBe("appearance")
    expect(normalizeSettingsSection("proxy")).toBe("proxy")
    expect(normalizeSettingsSection("telemetry")).toBe("network-telemetry")
    expect(normalizeSettingsSection("unknown")).toBe("commonly-used")
  })
})
