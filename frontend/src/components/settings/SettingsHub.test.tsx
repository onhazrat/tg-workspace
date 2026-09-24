/**
 * The decisions the Settings hub makes, and the props-only pieces it is
 * assembled from. The hub itself reads the route and the settings context, so
 * what is pinned here is what it hands them: which section a `?section=` or a
 * `?setting=` lands on, and what that section draws.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type React from "react"
import { BotManagement } from "@/components/BotManagement"
import { ConfigurationCatalogView } from "@/components/ConfigurationCatalogView"
import { DatabaseManagement } from "@/components/DatabaseManagement"
import {
  SETTINGS_VIEW_BODIES,
  SettingsView,
  settingsViewHeading,
} from "@/components/SettingsView"
import { VALID_SETTINGS_SECTIONS } from "@/lib/settings/toc"
import { AppearanceSection } from "./AppearanceSection"
import { CommonlyUsedSection } from "./CommonlyUsedSection"
import { NetworkSection } from "./NetworkSection"
import { SETTINGS_SECTION_CONTENT, SettingsSearchBar } from "./SettingsHubParts"
import { SyncSection } from "./SyncSection"
import {
  applyOperatorSuggestion,
  deepLinkTarget,
  loadsDbStats,
  sectionThemeClass,
} from "./settings-hub-model"

afterEach(cleanup)

describe("settings-hub-model", () => {
  test("a catalog id lands on its group, a panel on its own section", () => {
    expect(deepLinkTarget("theme")).toEqual({
      section: "appearance",
      scroll: true,
    })
    // The data group's rows live under Retention, not the Data overview.
    expect(deepLinkTarget("postRetentionDays")?.section).toBe("retention")
    expect(deepLinkTarget("panel-tor")).toEqual({
      section: "tor",
      scroll: true,
    })
  })

  test("a Configuration Catalog id opens that view without the hub scrolling", () => {
    expect(deepLinkTarget("deployment:POSTGRES_DB")).toEqual({
      section: "configuration",
      scroll: false,
    })
  })

  test("an id nothing knows lands nowhere", () => {
    expect(deepLinkTarget("no-such-setting")).toBeNull()
  })

  test("only the data sections load table stats, only diagnostics go dark", () => {
    expect(loadsDbStats("query")).toBe(true)
    expect(loadsDbStats("ai")).toBe(false)
    expect(sectionThemeClass("tools")).toBe("terminal-theme text-app-ink")
    expect(sectionThemeClass("appearance")).toBe("")
  })

  test("an operator replaces the @word being typed", () => {
    expect(applyOperatorSuggestion("proxy @mod", "@modified")).toBe(
      "proxy @modified ",
    )
    expect(applyOperatorSuggestion("proxy", "@modified")).toBe(
      "proxy@modified ",
    )
  })
})

describe("SETTINGS_SECTION_CONTENT", () => {
  const draw = (section: keyof typeof SETTINGS_SECTION_CONTENT) =>
    SETTINGS_SECTION_CONTENT[section]({
      highlightId: "h",
      deepLinkSetting: "user:x",
    }) as React.ReactElement<Record<string, unknown>>

  test("every TOC id draws something", () => {
    for (const section of VALID_SETTINGS_SECTIONS) {
      expect(draw(section)).toBeTruthy()
    }
  })

  test("a child section focuses its parent's panel on itself", () => {
    expect(draw("proxy").type).toBe(NetworkSection)
    expect(draw("proxy").props.focus).toBe("proxy")
    expect(draw("destinations").type).toBe(BotManagement)
    expect(draw("destinations").props.focus).toBe("destinations")
    expect(draw("table-sizes").type).toBe(DatabaseManagement)
    expect(draw("table-sizes").props.focus).toBe("table-sizes")
    expect(draw("channels-sync").type).toBe(SettingsView)
    expect(draw("channels-sync").props.activeSection).toBe("channels-sync")
    expect(draw("commonly-used").type).toBe(CommonlyUsedSection)
    expect(draw("configuration").type).toBe(ConfigurationCatalogView)
    expect(draw("configuration").props.focusId).toBe("user:x")
  })

  test("a panel section is highlighted only for its own id", () => {
    const panel = (highlightId: string) =>
      SETTINGS_SECTION_CONTENT["ai-keys"]({
        highlightId,
      }) as React.ReactElement<{ highlighted: boolean }>
    expect(panel("panel-ai-keys").props.highlighted).toBe(true)
    expect(panel("theme").props.highlighted).toBe(false)
  })
})

describe("SettingsSearchBar", () => {
  test("types, clears, and offers operators only after an @", () => {
    const onQueryChange = mock()
    render(
      <SettingsSearchBar
        query=""
        suggestions={["@modified"]}
        onQueryChange={onQueryChange}
      />,
    )
    expect(screen.queryByLabelText("Clear search")).toBeNull()
    expect(screen.queryByText("@modified")).toBeNull()
    fireEvent.change(screen.getByTestId("settings-search"), {
      target: { value: "tor" },
    })
    expect(onQueryChange).toHaveBeenLastCalledWith("tor")
    cleanup()
    render(
      <SettingsSearchBar
        query="tor @m"
        suggestions={["@modified"]}
        onQueryChange={onQueryChange}
      />,
    )
    fireEvent.click(screen.getByText("@modified"))
    expect(onQueryChange).toHaveBeenLastCalledWith("tor @modified ")
    fireEvent.click(screen.getByLabelText("Clear search"))
    expect(onQueryChange).toHaveBeenLastCalledWith("")
  })
})

describe("SettingsView", () => {
  test("each catalog section has its heading; anything else reads as Network", () => {
    expect(settingsViewHeading("channels-sync")).toBe(
      settingsViewHeading("sync"),
    )
    expect(settingsViewHeading("ai").title).toBe("AI & Models")
    expect(settingsViewHeading("unknown").title).toBe("Network Configuration")
  })

  test("each section draws its own body, and Commonly Used draws none", () => {
    expect(SETTINGS_VIEW_BODIES["channels-sync"]).toBe(SyncSection)
    expect(SETTINGS_VIEW_BODIES.appearance).toBe(AppearanceSection)
    expect(SETTINGS_VIEW_BODIES["commonly-used"]).toBeUndefined()
  })

  test("renders the heading over an empty body", () => {
    render(<SettingsView activeSection="commonly-used" />)
    expect(screen.getByText("Commonly Used")).toBeTruthy()
    expect(screen.getByText("[COMMONLY-USED]")).toBeTruthy()
    expect(screen.getByText("Frequently adjusted settings.")).toBeTruthy()
  })
})
