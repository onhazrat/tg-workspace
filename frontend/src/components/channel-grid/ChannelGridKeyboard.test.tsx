import { describe, expect, test } from "bun:test"
import { act, renderHook } from "@testing-library/react"
import { useChannelGridKeyboard } from "./ChannelGridKeyboard"

const press = (key: string) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key }))
  })

describe("useChannelGridKeyboard", () => {
  const props = {
    on: true,
    names: ["a", "b", "c", "d"],
    lanes: 2,
    firstVisibleRow: 1,
    scrollToRow: () => {},
  }

  test("j starts on the first row on screen; G and gg jump to the ends", () => {
    const { result } = renderHook(() => useChannelGridKeyboard(props))
    press("j")
    expect(result.current).toBe("c")
    press("G")
    expect(result.current).toBe("d")
    press("g")
    expect(result.current).toBe("d")
    press("g")
    expect(result.current).toBe("a")
    press("Escape")
    expect(result.current).toBeNull()
  })
})
