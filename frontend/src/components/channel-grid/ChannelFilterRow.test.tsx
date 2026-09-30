/**
 * The Channel filter row (CTB-01): shown only while something filters the
 * grid, a chip per Condition with an ×, the joiners between blocks, nested
 * groups as boxes, and "Clear all" at two or more filters.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type React from "react"
import {
  type ChannelFilter,
  emptyFilter,
  filterNames,
  parseChannelFilter,
} from "@/lib/channels/channel-filter"
import { ChannelFilterRow } from "./ChannelFilterRow"

afterEach(cleanup)

const names = filterNames([{ id: "g1", name: "Daily news" }])
const parse = (text: string) => parseChannelFilter(text, names) as ChannelFilter

function mount(over: Partial<React.ComponentProps<typeof ChannelFilterRow>>) {
  const calls: [string, unknown][] = []
  render(
    <ChannelFilterRow
      filter={emptyFilter()}
      search=""
      shownCount={3}
      totalCount={9}
      names={names}
      metrics={{ values: () => [100, 200, 300], total: 4 }}
      onRemove={(id) => calls.push(["remove", id])}
      onReplace={(id, cond) => calls.push(["replace", [id, cond]])}
      onClearSearch={() => calls.push(["search", null])}
      onClearAll={() => calls.push(["all", null])}
      {...over}
    />,
  )
  return calls
}

describe("ChannelFilterRow", () => {
  test("renders nothing while nothing filters the grid", () => {
    mount({ search: "  " })
    expect(screen.queryByTestId("channel-filter-row")).toBeNull()
  })

  test("counts the Shown Channels and shows each Condition as a chip", () => {
    mount({ filter: parse('tag:tech and group:"Daily news"') })
    expect(screen.getByTestId("channel-filter-count").textContent).toBe(
      "3 of 9",
    )
    expect(screen.getByText("tech")).toBeTruthy()
    expect(screen.getByText("Daily news")).toBeTruthy()
    expect(screen.getByText("and")).toBeTruthy()
  })

  test("× removes one Condition, and the search chip clears the search", () => {
    const filter = parse("tag:tech")
    const calls = mount({ filter, search: "rss" })
    fireEvent.click(screen.getByRole("button", { name: "Remove tech" }))
    fireEvent.click(screen.getByRole("button", { name: "Clear the search" }))
    expect(calls).toEqual([
      ["remove", filter.children[0].id],
      ["search", null],
    ])
  })

  test("Clear all shows at two or more filters, the search counting as one", () => {
    mount({ filter: parse("tag:tech") })
    expect(screen.queryByText("Clear all")).toBeNull()
    cleanup()
    const calls = mount({ filter: parse("tag:tech"), search: "rss" })
    fireEvent.click(screen.getByText("Clear all"))
    expect(calls).toEqual([["all", null]])
  })

  test("nested groups render as boxes, with their joiner and NOT", () => {
    mount({ filter: parse("tag:a or not (tag:b and lang:fa)") })
    const boxes = screen.getAllByTestId("channel-filter-group")
    expect(boxes).toHaveLength(1)
    expect(boxes[0].getAttribute("data-not")).toBe("true")
    expect(boxes[0].textContent).toContain("not")
    expect(boxes[0].textContent).toContain("and")
    expect(screen.getByText("or")).toBeTruthy()
    expect(screen.getByText("Persian")).toBeTruthy()
  })

  test("a negated Condition and a negated root say NOT", () => {
    mount({ filter: parse("not (tag:a and not tag:b)") })
    const chip = screen.getByTestId("channel-filter-chip-b")
    expect(chip.getAttribute("data-not")).toBe("true")
    expect(
      screen.getByTestId("channel-filter-blocks").getAttribute("data-not"),
    ).toBe("true")
  })

  test("a number chip reads as its bound and reopens its editor to update it", () => {
    const filter = parse("reach >= 1200 and subscribers 500..20000")
    const calls = mount({ filter })
    expect(
      screen.getByTestId("channel-filter-chip-metric-subscribers").textContent,
    ).toContain("Subscribers 500–20K")
    fireEvent.click(screen.getByRole("button", { name: "Reach ≥ 1.2K" }))
    const submit = screen.getByTestId("metric-editor-submit")
    expect(submit.textContent).toBe("Update · 0 of 3 measured")
    fireEvent.change(screen.getByRole("spinbutton", { name: "Value" }), {
      target: { value: "150" },
    })
    fireEvent.click(submit)
    expect(calls).toEqual([
      [
        "replace",
        [filter.children[0].id, { type: "metric", metric: "reach", min: 150 }],
      ],
    ])
  })
})
