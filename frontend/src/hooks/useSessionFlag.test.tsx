import { afterEach, describe, expect, test } from "bun:test"
import { act, cleanup, renderHook } from "@testing-library/react"
import { useCompactPostGrid, useSessionFlag } from "./useSessionFlag"

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

describe("session switches", () => {
  test("the Posts compact grid is on in a fresh session, and off lasts once chosen", () => {
    // Each mount reads the session afresh, as a reload of the page would.
    const mount = () => renderHook(() => useCompactPostGrid())
    const first = mount()
    expect(first.result.current[0]).toBe(true)
    act(() => first.result.current[1](false))
    expect(first.result.current[0]).toBe(false)
    first.unmount()

    const again = mount()
    expect(again.result.current[0]).toBe(false)
    act(() => again.result.current[1](true))
    again.unmount()
    expect(mount().result.current[0]).toBe(true)
  })

  test("a switch that defaults off is off until turned on, then stays on", () => {
    const mount = () => renderHook(() => useSessionFlag("postFeed_keyboard"))
    const first = mount()
    expect(first.result.current[0]).toBe(false)
    act(() => first.result.current[1](true))
    first.unmount()
    expect(mount().result.current[0]).toBe(true)
  })
})
