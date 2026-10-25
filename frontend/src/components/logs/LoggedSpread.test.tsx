/**
 * The Logged spread (TB-05): when a log's entries were logged, drawn by the
 * server, zoomed by the shared buttons, a bar setting a Fixed bound.
 * Rendered from props alone; the container asks the server for `zoom.range`.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { LogSpreadResponse } from "@/client"
import { useZoomState } from "@/components/SpreadZoom"
import type { Range } from "@/lib/spread"
import type { TimeBound } from "@/lib/time-bound/bound"
import { LoggedSpreadView } from "./LoggedSpread"

afterEach(cleanup)

const MINUTE = 60_000
/** 2021-01-01T00:00:00Z. */
const T0 = 1_609_459_200_000

/** 32 one-minute bars from T0, the last one closed on T0 + 32 minutes. */
const SPREAD: LogSpreadResponse = {
  total: 64,
  min: T0,
  max: T0 + 32 * MINUTE,
  median: T0 + 16 * MINUTE,
  bins: Array.from({ length: 32 }, (_, i) => ({
    lo: T0 + i * MINUTE,
    hi: T0 + (i + 1) * MINUTE,
    count: 2,
  })),
}

function mount(bound: TimeBound, spread: LogSpreadResponse | null = SPREAD) {
  const asked: (Range | null)[] = []
  const picked: TimeBound[] = []
  function Harness() {
    const zoom = useZoomState()
    asked.push(zoom.range)
    return (
      <LoggedSpreadView
        spread={spread ?? undefined}
        bound={bound}
        zoom={zoom}
        onPick={(b) => picked.push(b)}
      />
    )
  }
  render(<Harness />)
  return { asked, picked, last: () => asked[asked.length - 1] }
}

const pick = (i: number) => {
  fireEvent.pointerDown(screen.getByTestId(`spread-bar-${i}`))
  fireEvent.pointerUp(screen.getByTestId(`spread-bar-${i}`))
}

const press = (name: string) =>
  act(() => {
    fireEvent.click(screen.getByRole("button", { name }))
  })

describe("the Logged spread", () => {
  test("waits for the server before drawing", () => {
    mount({ mode: "live" }, null)
    expect(screen.getByText("Loading the spread…")).toBeTruthy()
  })

  test("its bars count entries", () => {
    mount({ mode: "live" })
    fireEvent.pointerEnter(screen.getByTestId("spread-bar-0"))
    expect(
      screen.getByTestId("spread-caption").children[1].textContent,
    ).toStartWith("2 entries, ")
  })

  test("Zoom in asks for a third, centred on the bound", () => {
    const z = mount({
      mode: "fixed",
      start: T0 + 10 * MINUTE,
      end: T0 + 12 * MINUTE,
    })
    press("Zoom in")
    // The whole is 32 minutes; a third of it around minute 11.
    expect(z.last()).toEqual([T0 + 340_000, T0 + 980_000])
  })

  test("with Any time it centres on the median, and Zoom out returns whole", () => {
    const z = mount({ mode: "live" })
    press("Zoom in")
    expect(z.last()).toEqual([T0 + 640_000, T0 + 1_280_000])
    press("Zoom out")
    expect(z.last()).toBeNull()
    expect(
      (screen.getByRole("button", { name: "Zoom out" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  test("a bar sets a Fixed bound over the minutes it holds", () => {
    const z = mount({ mode: "live" })
    pick(3)
    expect(z.picked).toEqual([
      { mode: "fixed", start: T0 + 3 * MINUTE, end: T0 + 4 * MINUTE },
    ])
  })

  test("the last bar touches the end of the whole: its End is left open", () => {
    const z = mount({ mode: "live" })
    pick(31)
    expect(z.picked).toEqual([{ mode: "fixed", start: T0 + 31 * MINUTE }])
  })

  test("zoomed short of the end, the last bar keeps its closing instant", () => {
    // The server's last bar counts its high edge, so the End is a minute past.
    const z = mount({ mode: "live" })
    press("Zoom in")
    pick(31)
    expect(z.picked).toEqual([
      { mode: "fixed", start: T0 + 31 * MINUTE, end: T0 + 33 * MINUTE },
    ])
  })
})
