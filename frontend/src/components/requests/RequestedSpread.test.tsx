/**
 * The Requested range picker's spread (RQS-09), props only: the bars, a
 * drag that picks a range, zoom, panning and full screen.
 */
import { afterEach, describe, expect, test } from "bun:test"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import type { RequestSpreadResponse } from "@/client"
import type { TimeBound } from "@/lib/time-bound/bound"
import { RequestedSpread } from "./RequestedSpread"

afterEach(cleanup)

const DAY = 86_400_000
const NOW = Date.parse("2026-10-31T12:00:00Z")
const day = (n: number) =>
  new Date(Date.parse("2026-10-01T00:00:00Z") + n * DAY)
    .toISOString()
    .slice(0, 19)

/** Thirty days, one more Request each day than the last. */
const SPREAD: RequestSpreadResponse = {
  recordDays: 7,
  hourlyDays: 30,
  buckets: Array.from({ length: 30 }, (_, i) => ({
    start: day(i),
    end: day(i + 1),
    requests: i + 1,
  })),
}

function mount(
  spread: RequestSpreadResponse = SPREAD,
  bound: TimeBound = { mode: "live", start: -30 * DAY },
) {
  const picked: TimeBound[] = []
  render(
    <RequestedSpread
      spread={spread}
      bound={bound}
      onPick={(b) => picked.push(b)}
      now={NOW}
    />,
  )
  return picked
}

const bars = (scope: HTMLElement = document.body) =>
  within(scope).getAllByTestId(/^requests-spread-bar-/)

describe("RequestedSpread", () => {
  test("says so while the spread loads, and when nothing is kept", () => {
    render(
      <RequestedSpread
        bound={{ mode: "live", start: -DAY }}
        onPick={() => {}}
        now={NOW}
      />,
    )
    expect(screen.getByText("Loading the spread…")).toBeTruthy()
    cleanup()
    mount({ ...SPREAD, buckets: [] })
    expect(screen.getByText("No Requests to spread.")).toBeTruthy()
  })

  test("draws a bar a day, solid inside the range", () => {
    mount(SPREAD, {
      mode: "fixed",
      start: Date.parse(`${day(28)}Z`),
      end: Date.parse(`${day(30)}Z`),
    })
    expect(bars()).toHaveLength(30)
    const solid = bars().filter((b) => b.dataset.solid === "true")
    expect(solid.map((b) => b.dataset.testid)).toEqual([
      "requests-spread-bar-28",
      "requests-spread-bar-29",
    ])
  })

  test("marks the 7-day and 30-day edges inside the bars", () => {
    mount()
    expect(screen.getByText("7d · each Request")).toBeTruthy()
    // 30 days before noon on the 31st is noon on the 1st, inside the first bar.
    expect(screen.getByText("30d · hourly")).toBeTruthy()
  })

  test("a drag across the bars picks their days as a Fixed range", () => {
    const picked = mount()
    fireEvent.pointerDown(bars()[3])
    fireEvent.pointerEnter(bars()[4])
    fireEvent.pointerEnter(bars()[5])
    fireEvent.pointerUp(bars()[5])
    expect(picked).toEqual([
      {
        mode: "fixed",
        start: Date.parse(`${day(3)}Z`),
        end: Date.parse(`${day(6)}Z`),
      },
    ])
  })

  test("zoomed, a scrollbar moves the spread and arrow keys step it", () => {
    mount()
    expect(screen.queryByRole("scrollbar")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }))
    // The zoom centres on the range's start, the spread's first day.
    const at = () =>
      Number(screen.getByRole("scrollbar").getAttribute("aria-valuenow"))
    expect(at()).toBe(0)
    fireEvent.keyDown(screen.getByRole("scrollbar"), { key: "ArrowRight" })
    const stepped = at()
    expect(stepped).toBeGreaterThan(0)
    fireEvent.keyDown(screen.getByRole("scrollbar"), { key: "ArrowLeft" })
    expect(at()).toBe(0)
  })

  test("full screen keeps the zoom, and its button leaves it", () => {
    mount()
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }))
    const zoomed = bars().length
    expect(zoomed).toBeLessThan(30)
    fireEvent.click(screen.getByRole("button", { name: "Spread full screen" }))
    const dialog = screen.getByRole("dialog")
    expect(bars(dialog)).toHaveLength(zoomed)
    expect(within(dialog).getByRole("scrollbar")).toBeTruthy()
    // One zoom for both: zooming out in full screen zooms the popover out.
    fireEvent.click(within(dialog).getByRole("button", { name: "Zoom out" }))
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Leave the spread's full screen",
      }),
    )
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(bars()).toHaveLength(30)
  })
})
