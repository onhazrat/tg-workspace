/**
 * The decisions `DatabaseManagement` makes and the page it renders. The
 * handlers stay in the shell with the hooks and the network; pinned here is
 * which panels a focus shows, what the size cache holds, what an export asks
 * for, and the toast text.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { SETTING_HIGHLIGHT_CLASS } from "@/components/settings/SettingAnchor"
import { DatabaseManagementView } from "./DatabaseManagementView"
import {
  allTableNames,
  type DatabaseFocus,
  exportSelection,
  failureText,
  importSummary,
  type PanelVisibility,
  panelVisibility,
  readCachedLastCalculated,
  readCachedSizes,
  tableToSelect,
  withTable,
  writeCachedSizes,
} from "./database-model"

afterEach(cleanup)

function memoryStorage(seed: Record<string, string> = {}) {
  const items = new Map(Object.entries(seed))
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value)
    },
  }
}

const sizes = [
  { name: "tg_posts", size: 10, count: 2 },
  { name: "tg_channels", size: 1, count: 1 },
]

describe("which panels a focus shows", () => {
  test.each([
    ["data", true, true, true, true],
    ["retention", false, true, false, false],
    ["table-sizes", true, false, true, true],
    ["transfer", false, false, true, false],
    ["query", false, false, true, false],
  ] as const)("%s", (focus, stats, retention, tables, about) => {
    expect(panelVisibility(focus as DatabaseFocus)).toEqual({
      stats,
      retention,
      tables,
      about,
    })
  })
})

describe("the size cache", () => {
  test("round-trips sizes and the time they were calculated, per source", () => {
    const storage = memoryStorage()
    writeCachedSizes(storage, "server", sizes, 1_700_000_000_000)
    expect([...storage.items.keys()]).toEqual([
      "tableSizesCache:server",
      "tableSizesLastCalculated:server",
    ])
    expect(readCachedSizes(storage, "server")).toEqual(sizes)
    expect(readCachedLastCalculated(storage, "server")).toBe(1_700_000_000_000)
  })

  test("empty or corrupt reads as nothing cached", () => {
    const storage = memoryStorage({ "tableSizesCache:server": "{not json" })
    expect(readCachedSizes(storage, "server")).toBeNull()
    expect(readCachedSizes(memoryStorage(), "server")).toBeNull()
    expect(readCachedLastCalculated(memoryStorage(), "server")).toBeNull()
  })
})

describe("table selection", () => {
  test("every table starts ticked, none when nothing is cached", () => {
    expect(allTableNames(sizes)).toEqual(new Set(["tg_posts", "tg_channels"]))
    expect(allTableNames(null)).toEqual(new Set())
  })

  test("the first table is picked only when none is", () => {
    expect(tableToSelect(sizes, "")).toBe("tg_posts")
    expect(tableToSelect(sizes, "tg_channels")).toBeNull()
    expect(tableToSelect([], "")).toBeNull()
  })

  test("ticking adds, unticking removes, and the old set is left alone", () => {
    const start = new Set(["a"])
    expect(withTable(start, "b", true)).toEqual(new Set(["a", "b"]))
    expect(withTable(start, "a", false)).toEqual(new Set())
    expect(start).toEqual(new Set(["a"]))
  })

  test("the whole selection exports everything, anything less names its tables", () => {
    expect(exportSelection(sizes, allTableNames(sizes))).toBeUndefined()
    expect(exportSelection(sizes, new Set(["tg_posts"]))).toEqual(["tg_posts"])
    expect(exportSelection(null, new Set())).toEqual([])
  })
})

describe("toast text", () => {
  test("an import lists what it wrote, or says it wrote nothing", () => {
    expect(importSummary({ tg_posts: 3, tg_channels: 1 })).toBe(
      "Import complete (tg_posts: 3, tg_channels: 1)",
    )
    expect(importSummary({})).toBe("Import complete (no records)")
  })

  test("a failure carries the error's message, or the thrown value", () => {
    expect(failureText("Export failed", new Error("disk full"))).toBe(
      "Export failed: disk full",
    )
    expect(failureText("Import failed", "nope")).toBe("Import failed: nope")
  })
})

function renderView(
  focus: DatabaseFocus | PanelVisibility,
  highlightId: string | null = null,
) {
  const calls: string[] = []
  const { container } = render(
    <DatabaseManagementView
      visible={typeof focus === "string" ? panelVisibility(focus) : focus}
      highlightId={highlightId}
      dbStats={{ postCount: 11, channelCount: 22, summaryCount: 33 }}
      retention={<p>retention panel</p>}
      tables={<p>tables panel</p>}
      confirmModal={{
        isOpen: true,
        title: "Clear Table: tg_posts",
        message: "Sure?",
        onConfirm: () => calls.push("confirm"),
      }}
      onRefreshStats={() => calls.push("refresh")}
      onDismissConfirm={() => calls.push("dismiss")}
    />,
  )
  return { calls, container }
}

describe("the page", () => {
  test("the data focus shows every section", () => {
    const { container } = renderView("data")
    expect(screen.getByText("retention panel")).toBeTruthy()
    expect(screen.getByText("tables panel")).toBeTruthy()
    expect(screen.getByText("About Storage")).toBeTruthy()
    expect(container.textContent).toContain("22")
    expect(
      container.querySelector('[data-setting-id="panel-retention"]'),
    ).toBeTruthy()
    expect(
      container.querySelector('[data-setting-id="panel-table-sizes"]'),
    ).toBeTruthy()
  })

  test("each section follows its own flag", () => {
    const { container } = renderView({
      stats: true,
      retention: false,
      tables: false,
      about: false,
    })
    expect(container.textContent).toContain("22")
    expect(screen.queryByText("About Storage")).toBeNull()
    cleanup()
    renderView({ stats: false, retention: false, tables: false, about: true })
    expect(screen.getByText("About Storage")).toBeTruthy()
  })

  test("the retention focus shows retention alone", () => {
    const { container } = renderView("retention")
    expect(screen.getByText("retention panel")).toBeTruthy()
    expect(screen.queryByText("tables panel")).toBeNull()
    expect(screen.queryByText("About Storage")).toBeNull()
    expect(container.textContent).not.toContain("22")
  })

  test("the highlighted anchor is the one named", () => {
    const { container } = renderView("data", "panel-table-sizes")
    const classOf = (id: string) =>
      container.querySelector(`[data-setting-id="${id}"]`)?.className ?? ""
    expect(classOf("panel-table-sizes")).toContain(SETTING_HIGHLIGHT_CLASS)
    expect(classOf("panel-retention")).not.toContain(SETTING_HIGHLIGHT_CLASS)
    cleanup()
    const other = renderView("data", "panel-retention").container
    expect(
      other.querySelector('[data-setting-id="panel-retention"]')?.className,
    ).toContain(SETTING_HIGHLIGHT_CLASS)
  })

  test("refresh and the confirm dialog report back", () => {
    const { calls, container } = renderView("transfer")
    fireEvent.click(container.querySelector("button") as HTMLButtonElement)
    expect(screen.getByText("Clear Table: tg_posts")).toBeTruthy()
    fireEvent.click(screen.getByText("Cancel"))
    // The dialog reports a cancel twice (onCancel, then onOpenChange); the
    // shell's dismiss is idempotent, so only its arrival is pinned.
    expect(calls[0]).toBe("refresh")
    expect(calls.slice(1).every((c) => c === "dismiss")).toBe(true)
    expect(calls.length).toBeGreaterThan(1)
  })
})
