/**
 * Adjust selection (CTB-04), rendered props-only: the Venn's regions, the
 * presets, the before and after line, Apply, and the action limit.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type React from "react"
import type { ActionLimit } from "@/lib/channels/selection-regions"
import {
  ActionLimitIndicator,
  ChannelSelectionAdjust,
} from "./ChannelSelectionAdjust"

afterEach(cleanup)

// Hidden selection {h1, h2}, selected and shown {b1}, shown only {f1, f2, f3}.
const selection = new Set(["h1", "h2", "b1"])
const shown = ["b1", "f1", "f2", "f3"]

function mount(
  over: Partial<React.ComponentProps<typeof ChannelSelectionAdjust>> = {},
) {
  const applied: Set<string>[] = []
  const limits: ActionLimit[] = []
  render(
    <ChannelSelectionAdjust
      selection={selection}
      shown={shown}
      onApply={(next) => applied.push(next)}
      limit="shown"
      onLimitChange={(next) => limits.push(next)}
      {...over}
    />,
  )
  fireEvent.click(screen.getByTestId("adjust-selection"))
  return { applied, limits }
}

const region = (name: RegExp) => screen.getByRole("checkbox", { name })
const HIDDEN = /hidden by filters/
const BOTH = /Selected and shown/
const FRESH = /Shown, not selected/
const change = () => screen.getByTestId("adjust-selection-change").textContent
const apply = () => screen.getByTestId("adjust-selection-apply")
const preset = (name: string) => screen.getByRole("button", { name })

describe("the Venn", () => {
  test("counts each region and opens on the picture that changes nothing", () => {
    mount()
    expect(region(HIDDEN).getAttribute("aria-label")).toContain(": 2")
    expect(region(BOTH).getAttribute("aria-label")).toContain(": 1")
    expect(region(FRESH).getAttribute("aria-label")).toContain(": 3")
    expect(region(HIDDEN).getAttribute("aria-checked")).toBe("true")
    expect(region(BOTH).getAttribute("aria-checked")).toBe("true")
    expect(region(FRESH).getAttribute("aria-checked")).toBe("false")
    expect(change()).toContain("no change")
    expect(apply().hasAttribute("disabled")).toBe(true)
  })

  test("a click drops a region, and Apply writes the selection without it", () => {
    const { applied } = mount()
    fireEvent.click(region(HIDDEN))
    expect(region(HIDDEN).getAttribute("aria-checked")).toBe("false")
    expect(change()).toContain("3 → 1 selected")
    expect(change()).toContain("−2 dropped")
    fireEvent.click(apply())
    expect(applied).toEqual([new Set(["b1"])])
  })

  test("a click keeps a region that was dropped, adding its Channels", () => {
    const { applied } = mount()
    fireEvent.click(region(FRESH))
    expect(change()).toContain("3 → 6 selected")
    expect(change()).toContain("+3 added")
    expect(apply().textContent).toBe("Apply · 6 selected")
    fireEvent.click(apply())
    expect(applied).toEqual([new Set(["h1", "h2", "b1", "f1", "f2", "f3"])])
  })

  test("Space and Enter switch a focused region", () => {
    mount()
    fireEvent.keyDown(region(BOTH), { key: " " })
    expect(region(BOTH).getAttribute("aria-checked")).toBe("false")
    fireEvent.keyDown(region(BOTH), { key: "Enter" })
    expect(region(BOTH).getAttribute("aria-checked")).toBe("true")
    expect(region(BOTH).getAttribute("tabindex")).toBe("0")
  })
})

describe("the presets", () => {
  test("a preset sets the picture, and lights up while it matches", () => {
    mount()
    fireEvent.click(preset("Invert shown"))
    expect(preset("Invert shown").getAttribute("aria-pressed")).toBe("true")
    expect(region(BOTH).getAttribute("aria-checked")).toBe("false")
    expect(region(FRESH).getAttribute("aria-checked")).toBe("true")
    expect(change()).toContain("3 → 5 selected")
    expect(change()).toContain("−1 dropped")
    expect(change()).toContain("+3 added")
  })

  test("the picture the clicks make lights its preset, else reads custom", () => {
    mount()
    fireEvent.click(region(HIDDEN))
    expect(preset("Keep only shown").getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(region(BOTH))
    expect(
      screen
        .getAllByRole("button")
        .filter((b) => b.getAttribute("aria-pressed") === "true")
        .map((b) => b.textContent),
    ).toEqual(["Shown"])
    expect(change()).toContain("custom")
  })

  test("a preset that would change nothing leaves Apply disabled", () => {
    mount({ selection: new Set(["b1"]) })
    fireEvent.click(preset("Keep only shown"))
    expect(change()).toContain("no change")
    expect(apply().hasAttribute("disabled")).toBe(true)
  })
})

describe("the action limit", () => {
  test("the popover repeats it as a two-way control", () => {
    const { limits } = mount({ limit: "shown" })
    expect(
      screen
        .getByRole("button", { name: /Shown/ })
        .getAttribute("aria-pressed"),
    ).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: /^All/ }))
    expect(limits).toEqual(["all"])
  })

  test("row 2's indicator shows only while the filters hide part of it", () => {
    const limits: ActionLimit[] = []
    const { rerender } = render(
      <ActionLimitIndicator
        selection={new Set(["b1"])}
        shown={shown}
        limit="shown"
        onLimitChange={(next) => limits.push(next)}
      />,
    )
    expect(screen.queryByTestId("action-limit-indicator")).toBeNull()
    rerender(
      <ActionLimitIndicator
        selection={selection}
        shown={shown}
        limit="shown"
        onLimitChange={(next) => limits.push(next)}
      />,
    )
    const badge = screen.getByTestId("action-limit-indicator")
    expect(badge.textContent).toBe("acting on 1 shown")
    fireEvent.click(badge)
    rerender(
      <ActionLimitIndicator
        selection={selection}
        shown={shown}
        limit="all"
        onLimitChange={(next) => limits.push(next)}
      />,
    )
    expect(screen.getByTestId("action-limit-indicator").textContent).toBe(
      "2 hidden by filters",
    )
    fireEvent.click(screen.getByTestId("action-limit-indicator"))
    expect(limits).toEqual(["all", "shown"])
  })
})
