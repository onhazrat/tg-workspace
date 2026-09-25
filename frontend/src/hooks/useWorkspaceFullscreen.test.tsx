/**
 * The fullscreen toggle drives two things, focus mode and the browser's native
 * fullscreen, and the hook's docstring says why each rule below exists. The
 * one that matters most: focus mode follows the click even when the browser
 * refuses fullscreen, and leaving native fullscreen from outside the app (Esc,
 * F11) drops focus mode, or the page is left chromeless with no way back.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"

import { ThemeProvider } from "@/components/theme-provider"
import { SettingsProvider } from "@/contexts/SettingsContext"
import { useWorkspaceFullscreen } from "@/hooks/useWorkspaceFullscreen"
import { scopedStorage } from "@/lib/storage/scoped"

const root = document.documentElement
const original = {
  request: root.requestFullscreen,
  exit: document.exitFullscreen,
}
let fullscreenElement: Element | null = null
let request: ReturnType<typeof mock>
let exit: ReturnType<typeof mock>

function mount() {
  const client = new QueryClient()
  return renderHook(() => useWorkspaceFullscreen(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <SettingsProvider>{children}</SettingsProvider>
        </ThemeProvider>
      </QueryClientProvider>
    ),
  }).result
}

beforeEach(() => {
  scopedStorage.removeItem("workspaceFocusMode")
  fullscreenElement = null
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  })
  request = mock(async () => {
    fullscreenElement = root
  })
  exit = mock(async () => {
    fullscreenElement = null
  })
  root.requestFullscreen = request
  document.exitFullscreen = exit
})

afterEach(() => {
  cleanup()
  root.requestFullscreen = original.request
  document.exitFullscreen = original.exit
  delete (document as { fullscreenElement?: unknown }).fullscreenElement
})

describe("useWorkspaceFullscreen", () => {
  test("toggling on enters focus mode and asks for native fullscreen", async () => {
    const result = mount()
    await act(() => result.current.toggle())
    expect(result.current.isFullscreen).toBe(true)
    expect(request).toHaveBeenCalledTimes(1)
  })

  test("a refused fullscreen request still leaves focus mode on", async () => {
    root.requestFullscreen = mock(() =>
      Promise.reject(new Error("not allowed")),
    )
    const result = mount()
    await act(() => result.current.toggle())
    expect(result.current.isFullscreen).toBe(true)
  })

  test("toggling off leaves native fullscreen only if the browser is in it", async () => {
    const result = mount()
    await act(() => result.current.toggle())
    await act(() => result.current.toggle())
    expect(result.current.isFullscreen).toBe(false)
    expect(exit).toHaveBeenCalledTimes(1)

    // Already windowed: exitFullscreen would reject, so it is not called.
    await act(() => result.current.toggle())
    fullscreenElement = null
    await act(() => result.current.toggle())
    expect(exit).toHaveBeenCalledTimes(1)
  })

  test("leaving fullscreen from outside the app drops focus mode", async () => {
    const result = mount()
    await act(() => result.current.toggle())
    fullscreenElement = null
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"))
    })
    expect(result.current.isFullscreen).toBe(false)
  })
})
