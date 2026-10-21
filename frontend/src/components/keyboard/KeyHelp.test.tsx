/**
 * Keyboard mode's help (ADR-034): `?` and the shortcuts button step from the
 * pill, to the tab's keys in the corner, to the full list, and back; the
 * corner is skipped without a list; with keyboard mode off `?` opens the full
 * list on its own and every hint hides until it is back. A waiting `g` or a
 * count lists its next keys above the corner after a moment.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { ShortcutsDialog } from "@/components/workspace-shell/WorkspaceShellParts"
import { keydowns } from "@/lib/keyboard/keydowns"
import {
  pending,
  setAdhocHelp,
  setHelp,
  setKeyboardMode,
} from "@/lib/keyboard/mode"
import { KeyboardMode, useHelpControls } from "./KeyboardMode"
import { useKeyboardList } from "./useKeyboardList"

const OPS = {
  go: () => {},
  step: () => {},
  goToNth: () => {},
  close: () => {},
  reopen: () => {},
}

function Directory() {
  useKeyboardList({
    list: "directory",
    items: ["a", "b"],
    element: () => null,
    reveal: () => {},
    name: (h) => `@${h}`,
  })
  return null
}

/** The header's shortcuts button and the full list, as `App` wires them. */
function Shell({ list = true }: { list?: boolean }) {
  const help = useHelpControls()
  return (
    <>
      <KeyboardMode ops={OPS} />
      {list && <Directory />}
      <button type="button" aria-label="Keyboard shortcuts" {...help.button} />
      <ShortcutsDialog
        open={help.fullOpen}
        onOpenChange={help.onFullOpenChange}
        commandKey="Cmd"
      />
    </>
  )
}

const type = (...keys: string[]) => {
  for (const init of keydowns(...keys))
    fireEvent.keyDown(document.activeElement ?? document.body, init)
}
const pill = () => screen.queryByText(/keyboard mode ·/)
const corner = () => screen.queryByText("open or close the panel")
const full = () => screen.queryByRole("dialog", { name: "Keyboard shortcuts" })
const wait = (ms: number) =>
  act(() => new Promise((resolve) => setTimeout(resolve, ms)))

const RealMatchMedia = window.matchMedia
beforeEach(() => {
  // A desk: the corner list is shown at md and up.
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
  setHelp("closed")
  setAdhocHelp(false)
  pending.set({ g: false, count: "" })
  setKeyboardMode(true)
})
afterEach(() => {
  cleanup()
  setKeyboardMode(false)
  window.matchMedia = RealMatchMedia
})

describe("help in three steps", () => {
  test("? steps from the pill, to the corner, to the full list, and back", () => {
    render(<Shell />)
    expect(pill()?.textContent).toBe("keyboard mode · ? keys · \\ off")
    expect(corner()).toBeNull()
    type("?")
    expect(corner()).toBeTruthy()
    expect(pill()).toBeNull()
    type("?")
    expect(full()).toBeTruthy()
    type("?")
    expect(full()).toBeNull()
    expect(corner()).toBeNull()
    expect(pill()).toBeTruthy()
  })

  test("the shortcuts button steps the same three, and the press that closes the full list is not a step too", () => {
    render(<Shell />)
    const button = screen.getByRole("button", { name: "Keyboard shortcuts" })
    fireEvent.click(button)
    expect(corner()).toBeTruthy()
    fireEvent.click(button)
    expect(full()).toBeTruthy()
    // The full list closes on the press outside it, before the click lands.
    fireEvent.pointerDown(button)
    act(() => {
      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: "Escape",
        code: "Escape",
      })
    })
    fireEvent.click(button)
    expect(full()).toBeNull()
    expect(corner()).toBeNull()
  })

  test("a full list opened alone ends when keyboard mode is switched", () => {
    render(<Shell />)
    act(() => setKeyboardMode(false))
    type("?")
    expect(full()).toBeTruthy()
    type("\\")
    expect(full()).toBeNull()
    act(() => setKeyboardMode(false))
    expect(full()).toBeNull()
  })

  test("a tab without a list skips the corner", () => {
    render(<Shell list={false} />)
    type("?")
    expect(full()).toBeTruthy()
  })

  test("off, every hint hides and ? opens the full list alone; on again, the corner is back", () => {
    render(<Shell />)
    type("?")
    expect(corner()).toBeTruthy()
    act(() => setKeyboardMode(false))
    expect(corner()).toBeNull()
    expect(pill()).toBeNull()
    type("?")
    expect(full()).toBeTruthy()
    type("?")
    expect(full()).toBeNull()
    act(() => setKeyboardMode(true))
    expect(corner()).toBeTruthy()
  })
})

describe("what a waiting g or count leads to", () => {
  test("after a moment, the g's keys show above the pill; a quick gt never shows them", async () => {
    render(<Shell list={false} />)
    type("g")
    expect(screen.queryByText("g, then")).toBeNull()
    await wait(350)
    const list = screen.getByText("g, then").parentElement as HTMLElement
    expect(list.textContent).toContain("Directory")
    // Stacked above the pill, in the corner's own column.
    expect(list.compareDocumentPosition(pill() as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    type("t")
    expect(screen.queryByText("g, then")).toBeNull()
  })

  test("a count lists its next keys, and after its g only t and T", async () => {
    render(<Shell />)
    type("5")
    await wait(350)
    expect(screen.getByText("5, then")).toBeTruthy()
    expect(screen.getByText("move 5")).toBeTruthy()
    type("g")
    expect(screen.getByText("5 and g, then")).toBeTruthy()
    expect(screen.getByText("5 tabs back")).toBeTruthy()
    type("Escape")
    expect(screen.queryByText(/then$/)).toBeNull()
  })
})

describe("the full list", () => {
  test("is sentence case, shows keys as typed and the tab's own keys", () => {
    render(<Shell />)
    type("?", "?")
    const dialog = full() as HTMLElement
    expect(dialog.className).not.toContain("uppercase")
    expect(dialog.querySelector(".uppercase")).toBeNull()
    expect(screen.getByText("Command palette")).toBeTruthy()
    expect(screen.getByText("Cmd+Shift+P")).toBeTruthy()
    // The Directory's x in its own word, keys as typed.
    expect(screen.getByText("Tick or untick")).toBeTruthy()
    expect(screen.getByText("gT")).toBeTruthy()
    expect(screen.getByText("Next / previous page")).toBeTruthy()
  })
})
