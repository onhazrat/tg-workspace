/**
 * The Groups, Tags and Languages dropdown (CTB-01), rendered props-only. What
 * is pinned is what an Account reads and does on it: the button's state, a
 * tick that selects a row, a partial tick, a funnel, the search.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type React from "react"
import { ChannelFacetMenu, type FacetRow } from "./ChannelFacetMenu"

afterEach(cleanup)

const rows: FacetRow[] = [
  { id: "tech", label: "tech", names: ["a", "b"] },
  { id: "news", label: "news", names: ["c"] },
  {
    id: "__untagged__",
    label: "Untagged",
    names: ["d"],
    explanation: "Channels that have no tags yet",
  },
]

function mount(
  over: Partial<React.ComponentProps<typeof ChannelFacetMenu>> = {},
) {
  const calls: [string, unknown][] = []
  const view = render(
    <ChannelFacetMenu
      label="Tags"
      noun="tag"
      testId="channel-tags"
      rows={rows}
      selectedChannels={new Set(["a", "c"])}
      funnelled={[]}
      onToggleSelect={(row) => calls.push(["select", row.id])}
      onFunnel={(id, on) => calls.push(["funnel", [id, on]])}
      onClearFunnels={() => calls.push(["clear", null])}
      {...over}
    />,
  )
  return { calls, view }
}

const open = () => fireEvent.click(screen.getByTestId("channel-tags"))
const row = (id: string) => screen.getByTestId(`channel-tags-row-${id}`)

describe("the button", () => {
  test("names the dropdown and counts rows with something selected", () => {
    mount()
    const button = screen.getByTestId("channel-tags")
    expect(button.textContent).toBe("Tags2")
    expect(button.getAttribute("data-active")).toBe("false")
  })

  test("shows the one funnelled value, or how many, and fills in", () => {
    mount({ funnelled: ["news"] })
    expect(screen.getByTestId("channel-tags").textContent).toContain("news")
    expect(screen.getByTestId("channel-tags").getAttribute("data-active")).toBe(
      "true",
    )
    cleanup()
    mount({ funnelled: ["news", "tech", "__untagged__"] })
    expect(screen.getByTestId("channel-tags").textContent).toContain("3 tags")
  })
})

describe("the list", () => {
  test("ticks a row as selected, partial or none, with selected/total", () => {
    mount({ selectedChannels: new Set(["a", "c"]) })
    open()
    expect(row("tech").getAttribute("aria-checked")).toBe("mixed")
    expect(row("news").getAttribute("aria-checked")).toBe("true")
    expect(row("__untagged__").getAttribute("aria-checked")).toBe("false")
    expect(screen.getByTestId("channel-tags-count-tech").textContent).toBe(
      "1/2",
    )
  })

  test("a tick selects the row and a funnel filters to it", () => {
    const { calls } = mount({ funnelled: ["news"] })
    open()
    fireEvent.click(row("tech"))
    fireEvent.click(screen.getByTestId("channel-tags-funnel-tech"))
    fireEvent.click(screen.getByTestId("channel-tags-funnel-news"))
    expect(calls).toEqual([
      ["select", "tech"],
      ["funnel", ["tech", true]],
      ["funnel", ["news", false]],
    ])
    expect(
      screen
        .getByTestId("channel-tags-funnel-news")
        .getAttribute("aria-pressed"),
    ).toBe("true")
  })

  test("Clear funnels shows only once a funnel is on", () => {
    mount()
    open()
    expect(screen.queryByText(/Clear \d+ funnel/)).toBeNull()
    cleanup()
    const { calls } = mount({ funnelled: ["news", "tech"] })
    open()
    fireEvent.click(screen.getByText("Clear 2 funnels"))
    expect(calls).toEqual([["clear", null]])
  })

  test("lists the derived tags under their own heading with the explanation", () => {
    mount()
    open()
    expect(screen.getByText("Derived")).toBeTruthy()
    expect(screen.getByText("Channels that have no tags yet")).toBeTruthy()
  })

  test("its own search narrows the rows", () => {
    mount()
    open()
    fireEvent.change(screen.getByPlaceholderText("Search tags..."), {
      target: { value: "NE" },
    })
    expect(screen.queryByTestId("channel-tags-row-tech")).toBeNull()
    expect(row("news")).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText("Search tags..."), {
      target: { value: "zzz" },
    })
    expect(screen.getByText("No tag matches zzz")).toBeTruthy()
  })

  test("a controlled search is left to the caller, which narrows the rows", () => {
    const typed: string[] = []
    mount({ search: { value: "te", onChange: (v) => typed.push(v) } })
    open()
    // The caller already narrowed the rows it passed, so none is hidden here.
    expect(row("news")).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText("Search tags..."), {
      target: { value: "tec" },
    })
    expect(typed).toEqual(["tec"])
  })
})
