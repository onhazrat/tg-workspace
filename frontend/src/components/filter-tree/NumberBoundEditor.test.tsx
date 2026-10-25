/**
 * The one Number bound editor (SPR-02, ADR-037), through its interface: per
 * source and switch, what an Account sees and gets. How a pick on the
 * Spread becomes the operator and the rounded fields, the median prefill,
 * the note and the count on Add. The Spread's own rules are
 * `Spread.test.tsx`'s; each caller's mapping is its own test file's.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { useZoomState } from "@/components/SpreadZoom"
import type { MetricBound } from "@/lib/channels/channel-metrics"
import type { Range } from "@/lib/spread"
import { NumberBoundEditor, type ReadBars } from "./NumberBoundEditor"

afterEach(cleanup)

/** 100 to 1,000 in steps of 10: linear, each bar 28.125 wide. */
const LINEAR = Array.from({ length: 91 }, (_, i) => 100 + i * 10)

/** A server's log spread, 10 to 100K, with 20 of no value. */
const READ: ReadBars = {
  bars: [
    { lo: 10, hi: 100, count: 30 },
    { lo: 100, hi: 1000, count: 40 },
    { lo: 1000, hi: 100_000, count: 30 },
  ],
  lo: 10,
  hi: 100_000,
  median: 1234,
  log: true,
  noValue: 20,
}

type Props = ComponentProps<typeof NumberBoundEditor>

function mount(props: Partial<Props> = {}) {
  const submitted: MetricBound[] = []
  const back: true[] = []
  const all: Props = {
    label: "Reach",
    noun: "channels",
    source: { kind: "values", values: LINEAR, total: 100 },
    onSubmit: (bound) => submitted.push(bound),
    onBack: () => back.push(true),
    ...props,
  }
  const view = render(<NumberBoundEditor {...all} />)
  const rerender = (next: Partial<Props>) =>
    view.rerender(<NumberBoundEditor {...all} {...next} />)
  return { submitted, back, rerender }
}

/** The container's half of a read: keep the zoom, and ask for its range. */
function mountRead(
  read: ReadBars | null | undefined,
  props: Partial<Props> = {},
) {
  const asked: (Range | null)[] = []
  const counted: MetricBound[] = []
  function Container() {
    const zoom = useZoomState()
    asked.push(zoom.range)
    return (
      <NumberBoundEditor
        label="Subscribers"
        noun="channels"
        source={{
          kind: "read",
          read,
          zoom,
          count: (bound) => {
            counted.push(bound)
            return " · 77 channels"
          },
        }}
        onSubmit={() => {}}
        {...props}
      />
    )
  }
  render(<Container />)
  return { range: () => asked.at(-1), counted }
}

const bar = (i: number) => screen.getByTestId(`spread-bar-${i}`)
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
const input = (name: string) =>
  screen.getByRole("spinbutton", { name }) as HTMLInputElement
const field = (name: string) => input(name).value
const type = (name: string, value: string) =>
  fireEvent.change(input(name), { target: { value } })
const press = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }))
const submit = () =>
  screen.getByTestId("number-bound-submit") as HTMLButtonElement

describe("the head", () => {
  test("names the number, its unit and description, and goes back to the conditions", () => {
    const { back } = mount({
      unit: "posts per hour",
      description: "How often it posts.",
    })
    expect(screen.getByText("Reach")).toBeTruthy()
    expect(screen.getByText("posts per hour")).toBeTruthy()
    expect(screen.getByText("How often it posts.")).toBeTruthy()
    press("Back to the conditions")
    expect(back).toEqual([true])
  })
})

describe("local values", () => {
  test("prefill the median and count what the bound keeps of the measured", () => {
    mount()
    expect(pressed()).toEqual(["at least"])
    // The upper middle of 91 values is 550.
    expect(field("Value")).toBe("550")
    expect(submit().textContent).toBe("Add · 46 of 91")
    type("Value", "950")
    expect(submit().textContent).toBe("Add · 6 of 91")
  })

  test("no value counts the ones with none, and adds none", () => {
    const { submitted } = mount()
    expect(
      screen.getByText(/9 have no value and fail every bound/),
    ).toBeTruthy()
    press("no value")
    expect(submit().textContent).toBe("Add · 9 with no value")
    fireEvent.click(submit())
    expect(submitted).toEqual([{ none: true }])
  })

  test("without a total the note has no count", () => {
    mount({ source: { kind: "values", values: LINEAR } })
    expect(
      screen.getByText(/Anything with no value fails every bound/),
    ).toBeTruthy()
  })

  test("nothing with a value says so in a plain line, and starts empty", () => {
    mount({ source: { kind: "values", values: [], total: 4 } })
    expect(screen.queryByTestId("spread-bar-0")).toBeNull()
    expect(screen.getByText("Nothing has a value yet.")).toBeTruthy()
    expect(field("Value")).toBe("")
    expect(submit().disabled).toBe(true)
  })
})

describe("a pick on the Spread", () => {
  test("a run touching the first bar is at most", () => {
    mount()
    drag(0, 3)
    expect(pressed()).toEqual(["at most"])
    // The run ends at 100 + 4 × 28.125 = 212.5, which reads 210.
    expect(field("Value")).toBe("210")
  })

  test("a run touching the last bar is at least", () => {
    mount()
    drag(31, 28)
    expect(pressed()).toEqual(["at least"])
    // 100 + 28 × 28.125 = 887.5, which reads 890.
    expect(field("Value")).toBe("890")
  })

  test("anything in between is between, both edges rounded", () => {
    mount()
    drag(3, 4)
    expect(pressed()).toEqual(["between"])
    // 184.375 and 240.625, two significant figures each.
    expect([field("From"), field("To")]).toEqual(["180", "240"])
  })

  test("clicking one bar picks that bar alone", () => {
    mount()
    drag(10, 10)
    expect(pressed()).toEqual(["between"])
    expect([field("From"), field("To")]).toEqual(["380", "410"])
  })

  test("everything with a value keeps the low end exactly", () => {
    mount({
      source: { kind: "values", values: LINEAR.map((v) => v + 23.4) },
    })
    drag(0, 31)
    expect(pressed()).toEqual(["at least"])
    expect(field("Value")).toBe("123.4")
    expect(submit().textContent).toBe("Add · 91 of 91")
  })

  test("the bars inside the bound are solid", () => {
    mount({ initial: { min: 900 } })
    expect(bar(28).getAttribute("data-solid")).toBe("true")
    expect(bar(31).getAttribute("data-solid")).toBe("true")
    expect(bar(27).getAttribute("data-solid")).toBe("false")
  })
})

describe("the Condition", () => {
  test("an existing Condition updates, with its own fields", () => {
    const { submitted } = mount({ initial: { min: 200, max: 300 } })
    expect(pressed()).toEqual(["between"])
    expect(submit().textContent).toBe("Update · 11 of 91")
    fireEvent.click(submit())
    expect(submitted).toEqual([{ min: 200, max: 300 }])
  })

  test("has no NOT of its own; the chip negates", () => {
    mount()
    expect(screen.queryByRole("checkbox")).toBeNull()
  })

  test("an incomplete or backwards between cannot be added", () => {
    mount({ initial: { min: 500, max: 600 } })
    type("To", "")
    expect(submit().disabled).toBe(true)
    expect(submit().textContent).toBe("Update")
    type("To", "400")
    expect(submit().disabled).toBe(true)
  })
})

describe("a read source", () => {
  test("says so while loading, and keeps the field empty when the bars arrive", () => {
    const { rerender } = mount({
      source: { kind: "read", read: undefined, zoom: fixedZoom() },
    })
    expect(screen.getByText(/Loading the spread/)).toBeTruthy()
    rerender({ source: { kind: "read", read: READ, zoom: fixedZoom() } })
    expect(screen.getByTestId("spread-caption").textContent).toContain(
      "median 1.23K, log scale",
    )
    expect(field("Value")).toBe("")
    expect(submit().disabled).toBe(true)
  })

  test("nothing with a value says so in a plain line", () => {
    mountRead(null)
    expect(screen.getByText("Nothing has a value yet.")).toBeTruthy()
  })

  test("starts empty even with its bars, and shows the caller's count", () => {
    const { counted } = mountRead(READ)
    expect(field("Value")).toBe("")
    expect(submit().textContent).toBe("Add")
    type("Value", "500")
    expect(submit().textContent).toBe("Add · 77 channels")
    expect(counted.at(-1)).toEqual({ min: 500 })
  })

  test("the note counts the read's no value", () => {
    mountRead(READ)
    expect(
      screen.getByText(/20 have no value and fail every bound/),
    ).toBeTruthy()
  })

  test.each([
    { bar: 0, bound: { max: 100 } },
    { bar: 1, bound: { min: 100, max: 1000 } },
    { bar: 2, bound: { min: 1000 } },
  ])("a pick on bar $bar fills $bound", ({ bar: i, bound }) => {
    const { counted } = mountRead(READ)
    drag(i, i)
    expect(counted.at(-1)).toEqual(bound)
  })

  test("Zoom in asks for a third in log(1 + x), around the median", () => {
    const { range } = mountRead(READ)
    expect(range()).toBeNull()
    press("Zoom in")
    const [lo, hi] = range() ?? []
    expect(lo).toBeCloseTo(269.33, 1)
    expect(hi).toBeCloseTo(5641.03, 1)
    // The caption follows the range; the median and the scale stay whole.
    expect(screen.getByTestId("spread-caption").textContent).toBe(
      "269median 1.23K, log scale5.64K",
    )
  })

  test("Zoom in centres on the bound, and Zoom out asks for the whole again", () => {
    const { range } = mountRead(READ, { initial: { min: 100, max: 1000 } })
    press("Zoom in")
    const [lo, hi] = range() ?? []
    expect(lo).toBeCloseTo(119.61, 1)
    expect(hi).toBeCloseTo(2516.21, 1)
    press("Zoom out")
    expect(range()).toBeNull()
  })
})

describe("the switches", () => {
  test("a floor refuses a field under it", () => {
    mount({ min: 0 })
    expect(input("Value").min).toBe("0")
    type("Value", "-5")
    expect(submit().disabled).toBe(true)
    type("Value", "0")
    expect(submit().disabled).toBe(false)
  })

  test("a whole number is rounded inward, and refused when none is left", () => {
    const { submitted } = mount({ whole: true })
    press("between")
    type("From", "3.2")
    type("To", "3.8")
    expect(submit().disabled).toBe(true)
    type("From", "2.5")
    type("To", "30.5")
    fireEvent.click(submit())
    expect(submitted).toEqual([{ min: 3, max: 30 }])
  })

  test("without No value there is neither the operator nor the note", () => {
    mount({ noValue: false })
    expect(screen.queryByRole("button", { name: "no value" })).toBeNull()
    expect(screen.queryByText(/no value/)).toBeNull()
    expect(pressed()).toEqual(["at least"])
  })
})

/** A zoom no one moves, for a read whose bars the test swaps. */
function fixedZoom() {
  return { range: null, setRange: () => {} }
}
