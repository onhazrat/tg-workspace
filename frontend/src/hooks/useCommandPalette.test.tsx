/**
 * The palette's global shortcut is Cmd/Ctrl+Shift+P, and nothing else.
 *
 * Plain Cmd/Ctrl+P is the browser's print dialog, which people use; taking it
 * over, or opening the palette on it as well, would be a regression nobody
 * notices until they try to print.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { act, cleanup, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"

import { CommandPaletteProvider } from "@/components/CommandPaletteProvider"
import { useCommandPalette } from "@/hooks/useCommandPalette"

function mount() {
  return renderHook(() => useCommandPalette(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <CommandPaletteProvider>{children}</CommandPaletteProvider>
    ),
  }).result
}

/** Dispatch a keydown on `window`; returns whether it was default-prevented. */
function press(init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent("keydown", { cancelable: true, ...init })
  act(() => {
    window.dispatchEvent(event)
  })
  return event.defaultPrevented
}

afterEach(cleanup)

describe("useCommandPalette", () => {
  test.each([
    ["Ctrl", { ctrlKey: true }],
    ["Cmd", { metaKey: true }],
  ])(
    "%s+Shift+P toggles the palette and keeps the key from the page",
    (_mod, modifier) => {
      const result = mount()
      expect(press({ ...modifier, shiftKey: true, key: "P" })).toBe(true)
      expect(result.current.open).toBe(true)
      press({ ...modifier, shiftKey: true, key: "p" })
      expect(result.current.open).toBe(false)
    },
  )

  test.each([
    ["Ctrl+P, the print shortcut", { ctrlKey: true, key: "p" }],
    ["Shift+P without a modifier", { shiftKey: true, key: "P" }],
    ["Ctrl+Shift+O", { ctrlKey: true, shiftKey: true, key: "o" }],
  ])("%s is left alone", (_label, init) => {
    const result = mount()
    expect(press(init)).toBe(false)
    expect(result.current.open).toBe(false)
  })
})
