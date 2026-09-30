/**
 * The Filters dropdown (CTB-02), props-only: the button's count and fill,
 * every criterion listed with its bounds, the search, and picking one to add
 * a new Condition.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { MetricCond } from "@/lib/channels/channel-filter"
import { ChannelMetricMenu } from "./ChannelMetricMenu"

afterEach(cleanup)

function mount(conditions: MetricCond[] = []) {
  const added: MetricCond[] = []
  render(
    <ChannelMetricMenu
      conditions={conditions}
      data={{ values: () => [10, 20, 30], total: 5 }}
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
    mount([
      { type: "metric", metric: "reach", min: 200 },
      { type: "metric", metric: "reach", max: 50 },
    ])
    expect(button().textContent?.trim()).toBe("Filters2")
    expect(button().getAttribute("data-active")).toBe("true")
  })

  test("lists all eleven criteria, each with every bound on it", () => {
    mount([
      { type: "metric", metric: "reach", min: 1200 },
      { type: "metric", metric: "reach", none: true },
      { type: "metric", metric: "subscribers", min: 500, max: 20_000 },
    ])
    fireEvent.click(button())
    expect(screen.getAllByTestId(/^channel-filters-/)).toHaveLength(11)
    expect(screen.getByTestId("channel-filters-reach").textContent).toBe(
      "Reach≥ 1.2K, no value",
    )
    expect(screen.getByTestId("channel-filters-subscribers").textContent).toBe(
      "Subscribers500–20K",
    )
  })

  test("the search narrows the criteria", () => {
    mount()
    fireEvent.click(button())
    fireEvent.change(screen.getByPlaceholderText("Search criteria..."), {
      target: { value: "days" },
    })
    expect(
      screen.getAllByTestId(/^channel-filters-/).map((b) => b.textContent),
    ).toEqual(["Days since last update", "Days followed"])
  })

  test("picking a criterion opens its editor, and Add appends a new Condition", () => {
    const added = mount([{ type: "metric", metric: "reach", min: 200 }])
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
