/**
 * The Directory's bound editor (DIR-02), props-only: the measure's spread
 * under every other Condition as bars, its median and log scale, the four
 * modes, the day presets on a measure counted in days, the no-value note,
 * a click on a bar setting the bound, and the count preview on Add. NOT is
 * the chip's, so the editor has no box for it.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { DirectoryDistributionResponse } from "@/client"
import type { MetricBound } from "@/lib/channels/channel-metrics"
import { measureOf } from "@/lib/directory/directory-filter"
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
  const previewed: (MetricBound | null)[] = []
  render(
    <DirectoryBoundEditor
      measure={measureOf(measure)}
      initial={initial}
      distribution={distribution ?? undefined}
      usePreviewCount={(bound) => {
        previewed.push(bound)
        return bound ? 77 : undefined
      }}
      onSubmit={(bound) => submitted.push(bound)}
    />,
  )
  return { submitted, previewed }
}

const field = (name: string) =>
  screen.getByRole("spinbutton", { name }) as HTMLInputElement
const submit = () => screen.getByTestId("directory-bound-submit")

describe("the spread", () => {
  test("shows the median, the scale and how many have no value", () => {
    mount()
    expect(screen.getByText(/median 1.23K, log scale/)).toBeTruthy()
    expect(screen.getByText(/20 have no value/)).toBeTruthy()
  })

  test("a click on a bar sets the bound from that bar", () => {
    const { submitted } = mount()
    fireEvent.click(screen.getByTestId("directory-bound-bar-1"))
    expect(field("Value").value).toBe("100")
    fireEvent.click(submit())
    expect(submitted).toEqual([{ min: 100 }])
  })

  test("in between mode a bar sets both ends", () => {
    const { submitted } = mount()
    fireEvent.click(screen.getByRole("button", { name: "between" }))
    fireEvent.click(screen.getByTestId("directory-bound-bar-1"))
    fireEvent.click(submit())
    expect(submitted).toEqual([{ min: 100, max: 1000 }])
  })

  test("says so while the spread has not loaded", () => {
    mount({ distribution: null })
    expect(screen.getByText(/Loading the spread/)).toBeTruthy()
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

  test("offers day presets only on a measure counted in days", () => {
    mount()
    expect(screen.queryByRole("button", { name: "7 days" })).toBeNull()
    cleanup()
    const { submitted } = mount({ measure: "last_post_days" })
    fireEvent.click(screen.getByRole("button", { name: "7 days" }))
    fireEvent.click(submit())
    expect(submitted).toEqual([{ max: 7 }])
  })

  test("has no NOT of its own; the chip negates", () => {
    mount()
    expect(screen.queryByRole("checkbox")).toBeNull()
  })
})
