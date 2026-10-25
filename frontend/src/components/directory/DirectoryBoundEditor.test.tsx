/**
 * The Directory's bound editor (DIR-02), props-only: the measure's spread
 * under every other Condition as bars, its median and log scale, the four
 * modes, the no-value note, a pick on the Spread setting the bound, and the
 * count preview on Add. NOT is the chip's, so the editor has no box for it.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { DirectoryDistributionResponse } from "@/client"
import { useZoomState } from "@/components/SpreadZoom"
import type { MetricBound } from "@/lib/channels/channel-metrics"
import { measureOf } from "@/lib/directory/directory-filter"
import type { Range } from "@/lib/spread"
import { DirectoryBoundEditor } from "./DirectoryBoundEditor"

afterEach(cleanup)

const SPREAD: DirectoryDistributionResponse = {
  scale: "log",
  total: 120,
  noValue: 20,
  min: 10,
  max: 100_000,
  median: 1234,
  bins: [
    { lo: 10, hi: 100, count: 30 },
    { lo: 100, hi: 1000, count: 40 },
    { lo: 1000, hi: 100_000, count: 30 },
  ],
}

function mount({
  measure = "subscribers" as const,
  initial,
  distribution = SPREAD as DirectoryDistributionResponse | null,
}: {
  measure?: Parameters<typeof measureOf>[0]
  initial?: MetricBound
  distribution?: DirectoryDistributionResponse | null
} = {}) {
  const submitted: MetricBound[] = []
  const previewed: MetricBound[] = []
  render(
    <DirectoryBoundEditor
      measure={measureOf(measure)}
      initial={initial}
      distribution={distribution ?? undefined}
      countFor={(bound) => {
        previewed.push(bound)
        return " · 77 channels"
      }}
      onSubmit={(bound) => submitted.push(bound)}
    />,
  )
  return { submitted, previewed }
}

const field = (name: string) =>
  screen.getByRole("spinbutton", { name }) as HTMLInputElement
const submit = () => screen.getByTestId("directory-bound-submit")
/** A click on a bar: a one-bar run. */
const pick = (i: number) => {
  fireEvent.pointerDown(screen.getByTestId(`spread-bar-${i}`))
  fireEvent.pointerUp(screen.getByTestId(`spread-bar-${i}`))
}

describe("the spread", () => {
  test("shows the median, the scale and how many have no value", () => {
    mount()
    expect(screen.getByText(/median 1.23K, log scale/)).toBeTruthy()
    expect(screen.getByText(/20 have no value/)).toBeTruthy()
  })

  test.each([
    { bar: 0, bound: { max: 100 } },
    { bar: 1, bound: { min: 100, max: 1000 } },
    { bar: 2, bound: { min: 1000 } },
  ])("a pick on bar $bar sets $bound", ({ bar, bound }) => {
    const { submitted } = mount()
    pick(bar)
    fireEvent.click(submit())
    expect(submitted).toEqual([bound])
  })

  test("says so while the spread has not loaded", () => {
    mount({ distribution: null })
    expect(screen.getByText(/Loading the spread/)).toBeTruthy()
  })
})

describe("zoom (TB-04)", () => {
  /** The container's half: keep the zoom, and ask for its range. */
  function mountZoomed(initial?: MetricBound) {
    const asked: (Range | null)[] = []
    function Container() {
      const zoom = useZoomState()
      asked.push(zoom.range)
      return (
        <DirectoryBoundEditor
          measure={measureOf("subscribers")}
          initial={initial}
          distribution={SPREAD}
          zoom={zoom}
          countFor={() => null}
          onSubmit={() => {}}
        />
      )
    }
    render(<Container />)
    return () => asked.at(-1)
  }
  const press = (name: string) =>
    fireEvent.click(screen.getByRole("button", { name }))

  test("Zoom in asks for a third in log(1 + x), around the median", () => {
    const range = mountZoomed()
    expect(range()).toBeNull()
    press("Zoom in")
    const [lo, hi] = range() ?? []
    // 10 to 100K, a third of it around 1,234.
    expect(lo).toBeCloseTo(269.33, 1)
    expect(hi).toBeCloseTo(5641.03, 1)
    // The caption follows the range; the median and the scale stay whole.
    expect(screen.getByTestId("spread-caption").textContent).toBe(
      "269median 1.23K, log scale5.64K",
    )
  })

  test("centres on the bound, and Zoom out asks for the whole spread again", () => {
    const range = mountZoomed({ min: 100, max: 1000 })
    press("Zoom in")
    const [lo, hi] = range() ?? []
    expect(lo).toBeCloseTo(119.61, 1)
    expect(hi).toBeCloseTo(2516.21, 1)
    press("Zoom out")
    expect(range()).toBeNull()
    expect(
      (screen.getByRole("button", { name: "Zoom out" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })
})

describe("the bound", () => {
  test("Add carries the preview count of what the bound leaves", () => {
    const { previewed } = mount()
    expect(submit().textContent).toBe("Add")
    fireEvent.change(field("Value"), { target: { value: "500" } })
    expect(submit().textContent).toBe("Add · 77 channels")
    expect(previewed.at(-1)).toEqual({ min: 500 })
  })

  test("no value needs no number, and editing says Update", () => {
    const { submitted } = mount({ initial: { max: 5 } })
    expect(field("Value").value).toBe("5")
    fireEvent.click(screen.getByRole("button", { name: "no value" }))
    expect(submit().textContent).toBe("Update · 77 channels")
    fireEvent.click(submit())
    expect(submitted).toEqual([{ none: true }])
  })

  test("has no NOT of its own; the chip negates", () => {
    mount()
    expect(screen.queryByRole("checkbox")).toBeNull()
  })
})
