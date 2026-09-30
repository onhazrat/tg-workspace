/**
 * The Channel filter row (CTB-01, CTB-03): shown only while something
 * filters the grid, a chip per Condition, nested groups as boxes, and the
 * editor over them: joiners that switch, NOT on any block, a "+" per pair of
 * parentheses, and blocks that drag. Drags are dispatched as events, since a
 * real mouse drag does not run here.
 */
import { afterEach, describe, expect, test } from "bun:test"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import type React from "react"
import {
  type ChannelFilter,
  emptyFilter,
  filterNames,
  parseChannelFilter,
  printChannelFilter,
} from "@/lib/channels/channel-filter"
import { ChannelFilterRow } from "./ChannelFilterRow"

afterEach(cleanup)

const names = filterNames([{ id: "g1", name: "Daily news" }])
const parse = (text: string) => parseChannelFilter(text, names) as ChannelFilter
const print = (filter: ChannelFilter) => printChannelFilter(filter, names)

const options = {
  tag: [
    { id: "tech", label: "tech" },
    { id: "news", label: "news" },
  ],
  group: [{ id: "g1", label: "Daily news" }],
  language: [{ id: "fa", label: "Persian", hint: "fa" }],
}

function mount(over: Partial<React.ComponentProps<typeof ChannelFilterRow>>) {
  const changes: string[] = []
  const calls: string[] = []
  render(
    <ChannelFilterRow
      filter={emptyFilter()}
      search=""
      shownCount={3}
      totalCount={9}
      names={names}
      metrics={{ values: () => [100, 200, 300], total: 4 }}
      options={options}
      onChange={(next) => changes.push(print(next))}
      onClearSearch={() => calls.push("search")}
      onClearAll={() => calls.push("all")}
      {...over}
    />,
  )
  return { changes, calls }
}

const chip = (value: string) =>
  screen.getByTestId(`channel-filter-chip-${value}`)

/** A drag as the browser dispatches it, minus the mouse. */
const dataTransfer = { setData: () => {}, effectAllowed: "" }
const dragStart = (el: HTMLElement) => fireEvent.dragStart(el, { dataTransfer })
function dropOn(el: HTMLElement) {
  fireEvent.dragOver(el, { dataTransfer })
  fireEvent.drop(el, { dataTransfer })
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
    expect(screen.getByRole("button", { name: /^and$/ })).toBeTruthy()
  })

  test("× removes one Condition, and the search chip clears the search", () => {
    const { changes, calls } = mount({
      filter: parse("tag:tech and tag:news"),
      search: "rss",
    })
    fireEvent.click(screen.getByRole("button", { name: "Remove tech" }))
    fireEvent.click(screen.getByRole("button", { name: "Clear the search" }))
    expect(changes).toEqual(["tag:news"])
    expect(calls).toEqual(["search"])
  })

  test("Clear all shows at two or more filters, the search counting as one", () => {
    mount({ filter: parse("tag:tech") })
    expect(screen.queryByText("Clear all")).toBeNull()
    cleanup()
    const { calls } = mount({ filter: parse("tag:tech"), search: "rss" })
    fireEvent.click(screen.getByText("Clear all"))
    expect(calls).toEqual(["all"])
  })

  test("nested groups render as boxes, a colour per depth, with their NOT", () => {
    mount({
      filter: parse("(tag:a or (lang:fa and tag:b)) and not (tag:c or tag:d)"),
    })
    const boxes = screen.getAllByTestId("channel-filter-group")
    expect(boxes.map((box) => box.getAttribute("data-depth"))).toEqual([
      "0",
      "1",
      "0",
    ])
    expect(boxes.map((box) => box.getAttribute("data-not"))).toEqual([
      "false",
      "false",
      "true",
    ])
    expect(boxes[0].className).not.toBe(boxes[1].className)
    expect(screen.getByText("Persian")).toBeTruthy()
  })

  test("a joiner switches the operator of its whole group", () => {
    const { changes } = mount({ filter: parse("tag:a and tag:b and tag:c") })
    const [first] = screen.getAllByRole("button", { name: /^and$/ })
    fireEvent.click(first)
    expect(changes).toEqual(["tag:a or tag:b or tag:c"])
  })

  test("NOT toggles on a chip, a group and the whole filter", () => {
    const filter = parse("tag:a and (tag:b or tag:c)")
    const { changes } = mount({ filter })
    const notA = screen.getByRole("button", { name: "Negate a" })
    expect(notA.getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(notA)
    const box = screen.getByTestId("channel-filter-group")
    fireEvent.click(
      within(box).getByRole("button", { name: "Negate these parentheses" }),
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Negate the whole filter" }),
    )
    expect(changes).toEqual([
      "not tag:a and (tag:b or tag:c)",
      "tag:a and not (tag:b or tag:c)",
      "not (tag:a and (tag:b or tag:c))",
    ])
  })

  test("a negated chip and group are outlined and say so", () => {
    mount({ filter: parse("not tag:a and not (tag:b or tag:c)") })
    expect(chip("a").getAttribute("data-not")).toBe("true")
    expect(chip("b").getAttribute("data-not")).toBe("false")
    expect(
      screen
        .getByRole("button", { name: "Negate a" })
        .getAttribute("aria-pressed"),
    ).toBe("true")
  })

  test("parentheses come off only when they are not negated", () => {
    const { changes } = mount({ filter: parse("tag:a and (tag:b or tag:c)") })
    fireEvent.click(
      screen.getByRole("button", { name: "Remove these parentheses" }),
    )
    expect(changes).toEqual(["tag:a and tag:b and tag:c"])
    cleanup()
    mount({ filter: parse("tag:a and not (tag:b or tag:c)") })
    expect(
      screen.queryByRole("button", { name: "Remove these parentheses" }),
    ).toBeNull()
  })

  test("a chip goes in parentheses by itself, with the opposite operator", () => {
    const { changes } = mount({ filter: parse("tag:a and tag:b") })
    fireEvent.click(
      screen.getByRole("button", { name: "Put a in parentheses" }),
    )
    expect(changes).toEqual(["(tag:a) and tag:b"])
  })

  test("the root's + adds a Condition picked by kind and name", () => {
    const { changes } = mount({ filter: parse("tag:a") })
    fireEvent.click(screen.getByRole("button", { name: "Add a condition" }))
    fireEvent.click(screen.getByRole("button", { name: /Setting group/ }))
    fireEvent.click(screen.getByRole("button", { name: "Daily news" }))
    expect(changes).toEqual(['tag:a and group:"Daily news"'])
  })

  test("a group's + adds inside those parentheses, and the picker searches", () => {
    const { changes } = mount({ filter: parse("tag:a and (tag:b or tag:c)") })
    const box = screen.getByTestId("channel-filter-group")
    fireEvent.click(
      within(box).getByRole("button", {
        name: "Add a condition inside these parentheses",
      }),
    )
    fireEvent.change(screen.getByPlaceholderText("Search conditions..."), {
      target: { value: "lang" },
    })
    expect(screen.queryByRole("button", { name: /^Tag/ })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /Language/ }))
    fireEvent.click(screen.getByRole("button", { name: /Persian/ }))
    expect(changes).toEqual(["tag:a and (tag:b or tag:c or lang:fa)"])
  })

  test("a number picked from + opens its editor and adds the bound", () => {
    const { changes } = mount({ filter: parse("tag:a") })
    fireEvent.click(screen.getByRole("button", { name: "Add a condition" }))
    fireEvent.click(screen.getByRole("button", { name: "Reach" }))
    fireEvent.change(screen.getByRole("spinbutton", { name: "Value" }), {
      target: { value: "150" },
    })
    fireEvent.click(screen.getByTestId("metric-editor-submit"))
    expect(changes).toEqual(["tag:a and reach >= 150"])
  })

  test("a chip's label reopens the picker on its Condition to change it", () => {
    const { changes } = mount({ filter: parse("not tag:tech and lang:fa") })
    fireEvent.click(screen.getByRole("button", { name: "tech" }))
    const picker = within(screen.getByRole("dialog"))
    expect(
      picker.getByRole("button", { name: "tech" }).getAttribute("aria-current"),
    ).toBe("true")
    fireEvent.click(picker.getByRole("button", { name: "news" }))
    expect(changes).toEqual(["not tag:news and lang:fa"])
  })

  test("a number chip reads as its bound and reopens its editor to update it", () => {
    const { changes } = mount({
      filter: parse("reach >= 1200 and subscribers 500..20000"),
    })
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
    expect(changes).toEqual(["reach >= 150 and subscribers 500..20000"])
  })
})

describe("dragging", () => {
  test("gaps show only while dragging", () => {
    mount({ filter: parse("tag:a and tag:b") })
    expect(screen.queryAllByTestId("channel-filter-gap")).toHaveLength(0)
    dragStart(chip("a"))
    expect(screen.getAllByTestId("channel-filter-gap")).toHaveLength(3)
    fireEvent.dragEnd(chip("a"))
    expect(screen.queryAllByTestId("channel-filter-gap")).toHaveLength(0)
  })

  test("a chip dropped on a chip goes in parentheses with it", () => {
    const { changes } = mount({ filter: parse("tag:a and tag:b and tag:c") })
    dragStart(chip("c"))
    fireEvent.dragOver(chip("a"), { dataTransfer })
    expect(chip("a").getAttribute("data-drop")).toBe("true")
    fireEvent.drop(chip("a"), { dataTransfer })
    expect(changes).toEqual(["(tag:a or tag:c) and tag:b"])
  })

  test("a chip dropped in a gap moves there", () => {
    const { changes } = mount({ filter: parse("tag:a and tag:b and tag:c") })
    dragStart(chip("a"))
    const gaps = screen.getAllByTestId("channel-filter-gap")
    fireEvent.dragOver(gaps[3], { dataTransfer })
    expect(gaps[3].getAttribute("data-drop")).toBe("true")
    fireEvent.drop(gaps[3], { dataTransfer })
    expect(changes).toEqual(["tag:b and tag:c and tag:a"])
  })

  test("a nested chip drags alone, not the box around it", () => {
    const { changes } = mount({ filter: parse("(tag:a or tag:b) and tag:c") })
    dragStart(chip("b"))
    dropOn(chip("c"))
    expect(changes).toEqual(["tag:a and (tag:c or tag:b)"])
  })

  test("a whole pair of parentheses drags as one block", () => {
    const { changes } = mount({ filter: parse("(tag:a or tag:b) and tag:c") })
    dragStart(screen.getByTestId("channel-filter-group"))
    const gaps = screen.getAllByTestId("channel-filter-gap")
    // The box's own gaps are not offered: it cannot go inside itself.
    expect(gaps).toHaveLength(3)
    dropOn(gaps[2])
    expect(changes).toEqual(["tag:c and (tag:a or tag:b)"])
  })

  test("a block is never dropped into itself", () => {
    const { changes } = mount({ filter: parse("(tag:a or tag:b) and tag:c") })
    dragStart(screen.getByTestId("channel-filter-group"))
    fireEvent.dragOver(chip("a"), { dataTransfer })
    expect(chip("a").getAttribute("data-drop")).toBe("false")
    fireEvent.drop(chip("a"), { dataTransfer })
    dragStart(chip("a"))
    dropOn(screen.getByTestId("channel-filter-group"))
    expect(changes).toEqual([])
  })
})
