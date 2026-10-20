/**
 * The Filters dropdown (CTB-02, TB-03), props-only: the button's count and
 * fill, every number listed with its bounds and every moment under Times,
 * each with its symbol, the search, and picking one to add a new Condition.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { act } from "react"
import type {
  Cond,
  MetricAtom,
  MetricCond,
  TimeAtom,
} from "@/lib/channels/channel-filter"
import { ChannelMetricMenu } from "./ChannelMetricMenu"

afterEach(cleanup)

let seq = 0
const on = (bound: Omit<MetricCond, "type">, not?: boolean): MetricAtom => ({
  kind: "atom",
  id: `a${++seq}`,
  cond: { type: "metric", ...bound },
  ...(not ? { not } : {}),
})

const DAY = 86_400_000
const followedAgo = (days: number): TimeAtom => ({
  kind: "atom",
  id: `t${++seq}`,
  cond: {
    type: "time",
    moment: "followed_at",
    mode: "live",
    start: -days * DAY,
  },
})

function mount(conditions: (MetricAtom | TimeAtom)[] = []) {
  const added: Cond[] = []
  render(
    <ChannelMetricMenu
      conditions={conditions}
      data={{
        values: () => [10, 20, 30],
        total: 5,
        moments: () => [Date.now() - 2 * DAY, Date.now() - 20 * DAY],
      }}
      onAdd={(cond) => added.push(cond)}
    />,
  )
  return added
}

const button = () => screen.getByTestId("channel-filters")

describe("ChannelMetricMenu", () => {
  test("counts the number Conditions and fills in when one is set", () => {
    mount()
    expect(button().textContent?.trim()).toBe("Filters")
    expect(button().getAttribute("data-active")).toBe("false")
    cleanup()
    mount([on({ metric: "reach", min: 200 }), followedAgo(7)])
    expect(button().textContent?.trim()).toBe("Filters2")
    expect(button().getAttribute("data-active")).toBe("true")
  })

  test("lists the nine numbers, each with every bound on it, then the seven moments", () => {
    mount([
      on({ metric: "reach", min: 1200 }),
      on({ metric: "reach", none: true }, true),
      on({ metric: "subscribers", min: 500, max: 20_000 }),
    ])
    fireEvent.click(button())
    const rows = screen.getAllByTestId(/^channel-filters-/)
    expect(rows.map((r) => r.firstChild?.textContent)).toEqual([
      "Subscribers",
      "Reach",
      "Activity rate",
      "Total posts",
      "Posts in scope",
      "Photos",
      "Videos",
      "Files",
      "Links",
      "Followed",
      "Last update",
      "Sync start",
      "Oldest stored post",
      "Next regular sync",
      "Next dynamic sync",
      "Discovered",
    ])
    expect(screen.getByText("Times")).toBeTruthy()
    expect(screen.getByTestId("channel-filters-reach").textContent).toBe(
      "Reach≥ 1.2K, not no value",
    )
    expect(screen.getByTestId("channel-filters-subscribers").textContent).toBe(
      "Subscribers500–20K",
    )
  })

  test("the search narrows the criteria", () => {
    mount()
    fireEvent.click(button())
    fireEvent.change(screen.getByPlaceholderText("Search criteria..."), {
      target: { value: "sync" },
    })
    expect(
      screen.getAllByTestId(/^channel-filters-/).map((b) => b.textContent),
    ).toEqual(["Sync start", "Next regular sync", "Next dynamic sync"])
  })

  test("a number row carries #, a moment row a clock", () => {
    mount()
    fireEvent.click(button())
    const symbol = (id: string) =>
      screen.getByTestId(id).querySelector("svg")?.getAttribute("class") ?? ""
    expect(symbol("channel-filters-reach")).toContain("lucide-hash")
    expect(symbol("channel-filters-time-followed_at")).toContain("lucide-clock")
  })

  test("picking a moment opens its editor, and Add appends a Time bound", () => {
    const added = mount()
    fireEvent.click(button())
    fireEvent.click(screen.getByTestId("channel-filters-time-followed_at"))
    act(() => {
      fireEvent.focus(screen.getByLabelText("Duration"))
    })
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "7d" }))
    })
    expect(screen.getByTestId("channel-time-submit").textContent).toBe(
      "Add · 1 of 2 with a value",
    )
    fireEvent.click(screen.getByTestId("channel-time-submit"))
    expect(added).toEqual([
      {
        type: "time",
        moment: "followed_at",
        mode: "live",
        start: -7 * DAY,
        end: 0,
      },
    ])
    expect(screen.queryByTestId("channel-time-submit")).toBeNull()
  })

  test("picking a criterion opens its editor, and Add appends a new Condition", () => {
    const added = mount([on({ metric: "reach", min: 200 })])
    fireEvent.click(button())
    fireEvent.click(screen.getByTestId("channel-filters-reach"))
    fireEvent.change(screen.getByRole("spinbutton", { name: "Value" }), {
      target: { value: "25" },
    })
    fireEvent.click(screen.getByTestId("metric-editor-submit"))
    expect(added).toEqual([{ type: "metric", metric: "reach", min: 25 }])
    expect(screen.queryByTestId("metric-editor-submit")).toBeNull()
  })
})
