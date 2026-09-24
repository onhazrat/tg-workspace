/**
 * The pieces the workspace shell (`App`) is assembled from. The header buttons,
 * the tab nav and the scroll reset stay in `App.tsx`, where
 * `a11y-invariants.test.ts` reads them as source; what moved here is pinned by
 * behaviour instead.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { Channel } from "@/types"
import {
  ShortcutsDialog,
  StatusBanners,
  WorkspaceStats,
} from "./WorkspaceShellParts"
import {
  commandKeyFor,
  oldestSync,
  opensShortcuts,
  routingMode,
  THEME_TOOLTIPS,
} from "./workspace-shell-model"

afterEach(cleanup)

describe("workspace-shell-model", () => {
  test("Tor wins over a proxy, and neither is direct", () => {
    expect(routingMode({ torEnabled: true, proxyEnabled: true }).label).toBe(
      "Tor",
    )
    expect(routingMode({ torEnabled: false, proxyEnabled: true })).toEqual({
      label: "Proxy",
      dotClass: "bg-purple-500",
    })
    expect(routingMode({ torEnabled: false, proxyEnabled: false }).label).toBe(
      "Direct",
    )
  })

  test("each theme's tooltip names where a click goes next", () => {
    expect(THEME_TOOLTIPS.system).toContain("click for Light")
    expect(THEME_TOOLTIPS.light).toBe("Switch to Dark Mode")
    expect(THEME_TOOLTIPS.dark).toBe("Switch to System Mode")
  })

  test("the header's last sync is the stalest selected, unfrozen channel", () => {
    const channels = [
      { name: "a", lastUpdated: 300 },
      { name: "b", lastUpdated: 100 },
      { name: "frozen", lastUpdated: 1, isFrozen: true },
      { name: "unselected", lastUpdated: 0 },
    ] as Channel[]
    expect(oldestSync(channels, new Set(["a", "b", "frozen"]))).toBe(100)
    expect(oldestSync(channels, new Set(["frozen"]))).toBeNull()
    expect(oldestSync([{ name: "n" } as Channel], new Set(["n"]))).toBe(0)
  })

  test("a bare ? opens the shortcuts, but not while typing or with a modifier", () => {
    const key = (over: Partial<Parameters<typeof opensShortcuts>[0]>) =>
      opensShortcuts({
        key: "?",
        defaultPrevented: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        target: document.body,
        ...over,
      })
    expect(key({})).toBe(true)
    expect(key({ target: null })).toBe(true)
    expect(key({ key: "/" })).toBe(false)
    expect(key({ defaultPrevented: true })).toBe(false)
    expect(key({ metaKey: true })).toBe(false)
    expect(key({ ctrlKey: true })).toBe(false)
    expect(key({ altKey: true })).toBe(false)
    for (const tag of ["input", "textarea", "select"])
      expect(key({ target: document.createElement(tag) })).toBe(false)
    const editable = document.createElement("div")
    editable.contentEditable = "true"
    Object.defineProperty(editable, "isContentEditable", { value: true })
    expect(key({ target: editable })).toBe(false)
  })

  test("Apple platforms say Cmd, everything else Ctrl", () => {
    expect(commandKeyFor("MacIntel")).toBe("Cmd")
    expect(commandKeyFor("iPhone")).toBe("Cmd")
    expect(commandKeyFor("Win32")).toBe("Ctrl")
    expect(commandKeyFor(undefined)).toBe("Ctrl")
  })
})

describe("StatusBanners", () => {
  test("shows nothing while online and syncing", () => {
    render(
      <StatusBanners
        offline={false}
        autoSyncPausedUntil={null}
        onResumeAutoSync={() => {}}
      />,
    )
    expect(screen.queryByText("Server offline.")).toBeNull()
    expect(screen.queryByText("Auto-sync paused.")).toBeNull()
  })

  test("a pause that already ended shows no banner", () => {
    render(
      <StatusBanners
        offline
        autoSyncPausedUntil={Date.now() - 1000}
        onResumeAutoSync={() => {}}
      />,
    )
    expect(screen.getByText("Server offline.")).toBeTruthy()
    expect(screen.queryByText("Auto-sync paused.")).toBeNull()
  })

  test("a live pause offers to resume now", () => {
    const onResume = mock()
    render(
      <StatusBanners
        offline={false}
        autoSyncPausedUntil={Date.now() + 60_000}
        onResumeAutoSync={onResume}
      />,
    )
    fireEvent.click(screen.getByText("Resume Now"))
    expect(onResume).toHaveBeenCalledTimes(1)
  })
})

describe("ShortcutsDialog", () => {
  test("lists the palette shortcut with the platform's modifier", () => {
    render(<ShortcutsDialog open onOpenChange={() => {}} commandKey="Cmd" />)
    expect(screen.getByText("Cmd+Shift+P")).toBeTruthy()
    expect(screen.getByText("In the command palette")).toBeTruthy()
  })
})

describe("WorkspaceStats", () => {
  test("a dash with nothing selected, and the counts formatted", () => {
    render(
      <WorkspaceStats
        lastSync={null}
        activeChannels={3}
        postsInScope={12345}
      />,
    )
    expect(screen.getByText("—")).toBeTruthy()
    expect(screen.getByTestId("header-active-channels").textContent).toBe("3")
    expect(screen.getByText("12,345")).toBeTruthy()
  })
})
