/**
 * The number criterion editor (CTB-02), props-only. What is pinned is what an
 * Account does on it: a drag across the histogram and the operator it gives
 * at either edge, the rounding, the log axis, a bar's hover, and how many
 * Channels the bound keeps before it is added.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { MetricBound } from "@/lib/channels/channel-metrics"
import { ChannelMetricEditor, type MetricData } from "./ChannelMetricEditor"

afterEach(cleanup)

/** 100 to 1,000 in steps of 10: linear, each bar 28.125 wide. */
const LINEAR = Array.from({ length: 91 }, (_, i) => 100 + i * 10)

function mount(values: number[], initial?: MetricBound, total = 100) {
  const data: MetricData = { values: () => values, total }
  const submitted: MetricBound[] = []
  render(
    <ChannelMetricEditor
      metricKey="reach"
      data={data}
      initial={initial}
      onSubmit={(bound) => submitted.push(bound)}
    />,
  )
  return submitted
}

const bar = (i: number) => screen.getByTestId(`metric-bar-${i}`)
const drag = (from: number, to: number) => {
  fireEvent.pointerDown(bar(from))
  for (let i = from; i !== to; i += Math.sign(to - from)) {
    fireEvent.pointerEnter(bar(i + Math.sign(to - from)))
  }
  fireEvent.pointerUp(bar(to))
}
const pressed = () =>
  screen
    .getAllByRole("button", { pressed: true })
    .map((button) => button.textContent)
const field = (name: string) =>
  (screen.getByRole("spinbutton", { name }) as HTMLInputElement).value
const submit = () => screen.getByTestId("metric-editor-submit")

describe("dragging across the histogram", () => {
  test("a run touching the first bar is at most", () => {
    mount(LINEAR)
    drag(0, 3)
    expect(pressed()).toEqual(["at most"])
    // The run ends at 100 + 4 × 28.125 = 212.5, which reads 210.
    expect(field("Value")).toBe("210")
  })

  test("a run touching the last bar is at least", () => {
    mount(LINEAR)
    drag(31, 28)
    expect(pressed()).toEqual(["at least"])
    // 100 + 28 × 28.125 = 887.5, which reads 890.
    expect(field("Value")).toBe("890")
  })

  test("anything in between is between, both edges rounded", () => {
    mount(LINEAR)
    drag(3, 4)
    expect(pressed()).toEqual(["between"])
    // 184.375 and 240.625, two significant figures each.
    expect(field("From")).toBe("180")
    expect(field("To")).toBe("240")
  })

  test("clicking one bar picks that bar alone", () => {
    mount(LINEAR)
    drag(10, 10)
    expect(pressed()).toEqual(["between"])
    expect([field("From"), field("To")]).toEqual(["380", "410"])
  })

  test("the bars inside the bound are solid", () => {
    mount(LINEAR, { min: 900 })
    expect(bar(28).getAttribute("data-solid")).toBe("true")
    expect(bar(31).getAttribute("data-solid")).toBe("true")
    expect(bar(27).getAttribute("data-solid")).toBe("false")
  })
})

describe("the axis", () => {
  test("is linear across two orders of magnitude or fewer", () => {
    mount(LINEAR)
    expect(screen.getByTestId("metric-histogram-caption").textContent).toBe(
      "100median 5501K",
    )
  })

  test("goes logarithmic past two, and says so", () => {
    mount([1, 10, 100, 1000, 10_000])
    const caption = screen.getByTestId("metric-histogram-caption")
    expect(caption.textContent).toContain("log scale")
    // A linear axis would put 1, 10, 100 and 1,000 all in the first bar.
    const filled = Array.from({ length: 32 }, (_, i) => bar(i)).filter(
      (b) => b.style.height !== "2%",
    )
    expect(filled).toHaveLength(5)
  })

  test("hovering a bar says how many Channels it holds and its range", () => {
    mount(LINEAR)
    fireEvent.pointerEnter(bar(0))
    expect(
      screen.getByTestId("metric-histogram-caption").textContent,
    ).toContain("3 channels, 100–130")
  })
})

describe("the count and the Condition", () => {
  test("says how many measured Channels the bound keeps", () => {
    mount(LINEAR)
    fireEvent.change(screen.getByRole("spinbutton", { name: "Value" }), {
      target: { value: "950" },
    })
    expect(submit().textContent).toBe("Add · 6 of 91 measured")
  })

  test("no value counts the Channels nobody measured, and adds none", () => {
    const submitted = mount(LINEAR, undefined, 100)
    fireEvent.click(screen.getByRole("button", { name: "no value" }))
    expect(submit().textContent).toBe("Add · 9 with no value")
    fireEvent.click(submit())
    expect(submitted).toEqual([{ none: true }])
  })

  test("adds the bound it spells, and an existing Condition updates", () => {
    const submitted = mount(LINEAR, { min: 200, max: 300 })
    expect(pressed()).toEqual(["between"])
    expect(submit().textContent).toBe("Update · 11 of 91 measured")
    fireEvent.click(submit())
    expect(submitted).toEqual([{ min: 200, max: 300 }])
  })

  test("an incomplete between cannot be added", () => {
    mount(LINEAR, { min: 500, max: 600 })
    fireEvent.change(screen.getByRole("spinbutton", { name: "To" }), {
      target: { value: "" },
    })
    expect((submit() as HTMLButtonElement).disabled).toBe(true)
  })
})
