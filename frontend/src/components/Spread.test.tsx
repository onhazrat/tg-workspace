/**
 * The one Spread (ADR-037), through its interface: bars given directly,
 * pointer and key events on the bars and the scrollbar, and both zoom
 * adapters behind it. What is pinned is what an Account sees or gets: the
 * pick that comes back, the solid bars, the caption, where the zoom sits.
 */
import { afterEach, describe, expect, test } from "bun:test"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { useEffect } from "react"
import {
  useExtentZoomKit,
  useRangeZoomKit,
  useZoomState,
} from "@/components/SpreadZoom"
import { MINUTE_MS } from "@/lib/analysis-window"
import { formatCount } from "@/lib/format-count"
import { binSpread, nice, type Pick, type Range } from "@/lib/spread"
import { Spread } from "./Spread"

afterEach(cleanup)

/** 100 to 1,000 in steps of 10: linear, each bar 28.125 wide. */
const LINEAR = Array.from({ length: 91 }, (_, i) => 100 + i * 10)

type Bound = { min?: number; max?: number } | null

/** A range adapter over values binned in the browser, or "read" with a delay. */
function Ranged({
  values = LINEAR,
  bound = null,
  openEnds = true,
  debounce = 0,
  marks,
  onPick = () => {},
  onRange = () => {},
}: {
  values?: number[]
  bound?: Bound
  openEnds?: boolean
  debounce?: number
  marks?: { at: number; label: string }[]
  onPick?: (p: Pick) => void
  onRange?: (range: Range | null) => void
}) {
  const zoom = useZoomState()
  useEffect(() => {
    onRange(zoom.range)
  }, [zoom.range, onRange])
  const d = binSpread(values, zoom.range)
  const kit = useRangeZoomKit(
    zoom,
    { lo: d.lo, hi: d.hi, log: d.log, median: d.median, bound },
    debounce,
  )
  return (
    <Spread
      bars={d.bars}
      whole={[d.lo, d.hi]}
      shown={zoom.range ?? [d.lo, d.hi]}
      median={d.median}
      log={d.log}
      selected={bound}
      openEnds={openEnds}
      onPick={onPick}
      format={(v) => formatCount(nice(v))}
      noun="channels"
      zoom={kit}
      marks={marks}
      title="Reach"
    />
  )
}

function picks(props: Parameters<typeof Ranged>[0] = {}) {
  const got: Pick[] = []
  render(<Ranged {...props} onPick={(p) => got.push(p)} />)
  return got
}

const bar = (i: number, scope: HTMLElement = document.body) =>
  within(scope).getByTestId(`spread-bar-${i}`)
const bars = (scope: HTMLElement = document.body) =>
  within(scope).getAllByTestId(/^spread-bar-/)
const drag = (from: number, to: number) => {
  fireEvent.pointerDown(bar(from))
  for (let i = from; i !== to; i += Math.sign(to - from))
    fireEvent.pointerEnter(bar(i + Math.sign(to - from)))
  fireEvent.pointerUp(bar(to))
}
const caption = (scope: HTMLElement = document.body) =>
  within(scope).getByTestId("spread-caption").textContent
const click = (name: string, scope: HTMLElement = document.body) =>
  fireEvent.click(within(scope).getByRole("button", { name }))
const scrollbar = () => screen.getByRole("scrollbar")
const at = () => Number(scrollbar().getAttribute("aria-valuenow"))
/** The test DOM lays nothing out; give the bars and the track a width. */
const widen = (el: HTMLElement, width = 320) =>
  Object.defineProperty(el, "clientWidth", { value: width, configurable: true })
const settle = () => act(() => new Promise((r) => setTimeout(r, 200)))

describe("picking", () => {
  test("a click picks one bar, both ends set", () => {
    const got = picks()
    drag(10, 10)
    expect(got).toEqual([
      {
        min: 100 + 10 * 28.125,
        max: 100 + 11 * 28.125,
        all: false,
        run: { from: 10, to: 10 },
      },
    ])
  })

  test("a drag picks the run it covered, whichever way it went", () => {
    const got = picks()
    drag(5, 3)
    expect(got[0]).toMatchObject({
      min: 100 + 3 * 28.125,
      max: 100 + 6 * 28.125,
      run: { from: 3, to: 5 },
    })
  })

  test("touching the first bar leaves the low end open, the last the high", () => {
    const got = picks()
    drag(0, 3)
    drag(31, 28)
    expect(got[0]).toEqual({ max: 212.5, all: false, run: { from: 0, to: 3 } })
    expect(got[1]).toEqual({
      min: 887.5,
      all: false,
      run: { from: 28, to: 31 },
    })
  })

  test("touching both keeps everything with a value", () => {
    const got = picks()
    drag(0, 31)
    expect(got[0]).toEqual({ all: true, run: { from: 0, to: 31 } })
  })

  test("a zoom hiding an edge opens no end there", () => {
    const got = picks()
    click("Zoom in")
    drag(0, 3)
    expect(got[0].min).toBe(400)
  })

  test("a zoom held at the whole spread's edge still opens it", () => {
    // On log(1 + x), 10 comes back as 10.000000000000002 unless kept exact.
    const got = picks({
      values: [10, 100, 1000, 10_000, 100_000],
      bound: { max: 10 },
    })
    click("Zoom in")
    drag(0, 3)
    expect(got[0].min).toBeUndefined()
    // And after panning away and back.
    fireEvent.keyDown(scrollbar(), { key: "ArrowRight" })
    fireEvent.keyDown(scrollbar(), { key: "ArrowLeft" })
    drag(0, 3)
    expect(got[1].min).toBeUndefined()
  })

  test("refused open ends set both, even across the whole spread", () => {
    const got = picks({ openEnds: false })
    drag(0, 31)
    expect(got[0]).toEqual({
      min: 100,
      max: 1000,
      all: false,
      run: { from: 0, to: 31 },
    })
  })

  test("the bars the bound keeps are solid", () => {
    picks({ bound: { min: 900 } })
    const solid = bars().flatMap((b, i) =>
      b.dataset.solid === "true" ? [i] : [],
    )
    // 900 lies in bar 28, which runs to 915.6.
    expect(solid).toEqual([28, 29, 30, 31])
  })
})

describe("the caption", () => {
  test("names the hovered bar, and the median while nothing is hovered", () => {
    picks()
    expect(caption()).toBe("100median 5501K")
    fireEvent.pointerEnter(bar(0))
    expect(caption()).toBe("1003 channels, 100–1301K")
  })

  test("says when the scale is logarithmic", () => {
    picks({ values: [1, 10, 100, 1000, 10_000] })
    expect(caption()).toContain("median 100, log scale")
  })
})

describe("zoom and moving along", () => {
  test("zoom in centres on the bound, or the median without one", () => {
    picks({ bound: { min: 500, max: 800 } })
    click("Zoom in")
    expect(caption()).toBe("500median 550800")
    cleanup()
    picks()
    click("Zoom in")
    expect(caption()).toBe("400median 550700")
  })

  test("a scrollbar shows only while zoomed, and arrow keys move a quarter", () => {
    picks()
    expect(screen.queryByRole("scrollbar")).toBeNull()
    click("Zoom in")
    expect(caption()).toBe("400median 550700")
    fireEvent.keyDown(scrollbar(), { key: "ArrowRight" })
    expect(caption()).toBe("480median 550780")
    fireEvent.keyDown(scrollbar(), { key: "ArrowLeft" })
    expect(caption()).toBe("400median 550700")
  })

  test("arrow keys on the scrollbar reach nothing outside it", () => {
    const outside: string[] = []
    const listen = (e: KeyboardEvent) => outside.push(e.key)
    document.addEventListener("keydown", listen)
    try {
      picks()
      click("Zoom in")
      fireEvent.keyDown(scrollbar(), { key: "ArrowRight" })
      expect(outside).toEqual([])
    } finally {
      document.removeEventListener("keydown", listen)
    }
  })

  test("the wheel pans by what it scrolled and clamps at the ends", () => {
    picks()
    click("Zoom in")
    const area = screen.getByTestId("spread-bars")
    widen(area)
    // Half the bars' width: half of what is shown, 150.
    fireEvent.wheel(area, { deltaY: 160 })
    expect(caption()).toBe("550median 550850")
    fireEvent.wheel(area, { deltaX: 10_000, deltaY: 5 })
    expect(caption()).toBe("700median 5501K")
    fireEvent.wheel(area, { deltaY: -10_000 })
    expect(caption()).toBe("100median 550400")
  })

  test("dragging the thumb moves along the whole spread", () => {
    picks()
    click("Zoom in")
    widen(scrollbar().parentElement as HTMLElement, 900)
    fireEvent.pointerDown(scrollbar(), { clientX: 0 })
    // 100px of a 900px track is 100 of a 900-wide spread.
    fireEvent.pointerMove(window, { clientX: 100 })
    fireEvent.pointerUp(window)
    expect(caption()).toBe("500median 550800")
    fireEvent.pointerMove(window, { clientX: 400 })
    expect(caption()).toBe("500median 550800")
  })

  test("a server-drawn spread reads once the pan settles; the thumb moves at once", async () => {
    const reads: (Range | null)[] = []
    picks({ debounce: 150, onRange: (r) => reads.push(r) })
    click("Zoom in")
    const before = reads.length
    const start = at()
    fireEvent.keyDown(scrollbar(), { key: "ArrowRight" })
    fireEvent.keyDown(scrollbar(), { key: "ArrowRight" })
    expect(at()).toBeGreaterThan(start)
    expect(reads.length).toBe(before)
    // The bars stay where they were while the read waits.
    expect(caption()).toBe("400median 550700")
    await settle()
    expect(reads.length).toBe(before + 1)
    expect(caption()).toBe("550median 550850")
  })

  test("a zoom pressed while a pan waits is not overwritten by it", async () => {
    picks({ debounce: 150 })
    click("Zoom in")
    fireEvent.keyDown(scrollbar(), { key: "ArrowRight" })
    click("Zoom out")
    await settle()
    expect(caption()).toBe("100median 5501K")
  })

  test("marks draw inside the shown range only", () => {
    picks({
      marks: [
        { at: 300, label: "low" },
        { at: 900, label: "high" },
      ],
    })
    expect(screen.getByText("low")).toBeTruthy()
    expect(screen.getByText("high")).toBeTruthy()
    click("Zoom in")
    expect(screen.queryByText("low")).toBeNull()
    expect(screen.queryByText("high")).toBeNull()
  })
})

describe("full screen", () => {
  test("keeps the zoom, picks the same, and its button leaves it", () => {
    const got = picks()
    click("Zoom in")
    click("Spread full screen")
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText("Reach")).toBeTruthy()
    expect(caption(dialog)).toBe("400median 550700")
    expect(within(dialog).getByRole("scrollbar")).toBeTruthy()
    fireEvent.pointerDown(bar(0, dialog))
    fireEvent.pointerUp(bar(0, dialog))
    expect(got[0].min).toBe(400)
    // One zoom for both views.
    click("Zoom out", dialog)
    click("Leave the spread's full screen", dialog)
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(caption()).toBe("100median 5501K")
  })

  test("Escape leaves it before an enclosing popover hears the key", () => {
    const outside: string[] = []
    const listen = (e: KeyboardEvent) => outside.push(e.key)
    document.addEventListener("keydown", listen)
    try {
      picks()
      click("Spread full screen")
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
      expect(screen.queryByRole("dialog")).toBeNull()
      expect(outside).toEqual([])
    } finally {
      document.removeEventListener("keydown", listen)
    }
  })
})

/** The extent adapter, around a window, with a clock and an oldest Post. */
function Extent({
  start,
  end,
  now,
  oldest,
}: {
  start: number
  end: number
  now: number
  oldest: number | null
}) {
  const { extent, kit } = useExtentZoomKit({ start, end, now, oldest })
  const width = (extent[1] - extent[0]) / 60
  return (
    <>
      <output data-testid="extent">{extent.join(" ")}</output>
      <Spread
        bars={Array.from({ length: 60 }, (_, i) => ({
          lo: extent[0] + i * width,
          hi: extent[0] + (i + 1) * width,
          count: 1,
        }))}
        whole={null}
        shown={extent}
        selected={{ min: start, max: end }}
        openEnds={false}
        onPick={() => {}}
        format={String}
        noun="posts"
        zoom={kit}
        title="Posts"
      />
    </>
  )
}

describe("the extent adapter", () => {
  const H = 60 * MINUTE_MS
  const NOW = Date.UTC(2026, 9, 25, 12)
  const mount = (oldest: number | null = NOW - 1000 * H) =>
    render(<Extent start={NOW - H} end={NOW} now={NOW} oldest={oldest} />)
  const extent = () =>
    screen.getByTestId("extent").textContent?.split(" ").map(Number) ?? []

  test("starts at three times the window, up to now, and triples per step", () => {
    mount()
    expect(extent()).toEqual([NOW - 3 * H, NOW])
    expect(
      (screen.getByRole("button", { name: "Zoom in" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    click("Zoom out")
    expect(extent()).toEqual([NOW - 9 * H, NOW])
    click("Zoom in")
    expect(extent()).toEqual([NOW - 3 * H, NOW])
  })

  test("pans back in whole minutes once it settles, and never past now", async () => {
    mount()
    fireEvent.keyDown(scrollbar(), { key: "ArrowLeft" })
    expect(extent()).toEqual([NOW - 3 * H, NOW])
    await settle()
    // A quarter of three hours.
    expect(extent()).toEqual([NOW - 3.75 * H, NOW - 0.75 * H])
    for (const _ of [1, 2, 3])
      fireEvent.keyDown(scrollbar(), { key: "ArrowRight" })
    await settle()
    expect(extent()).toEqual([NOW - 3 * H, NOW])
    const area = screen.getByTestId("spread-bars")
    widen(area, 600)
    // 1/7 of three hours is not a whole minute.
    fireEvent.wheel(area, { deltaY: -600 / 7 })
    await settle()
    expect(extent()[0] % MINUTE_MS).toBe(0)
  })

  test("a window moved some other way drops the pan", async () => {
    const { rerender } = mount()
    fireEvent.keyDown(scrollbar(), { key: "ArrowLeft" })
    await settle()
    expect(extent()).toEqual([NOW - 3.75 * H, NOW - 0.75 * H])
    rerender(
      <Extent
        start={NOW - 2 * H}
        end={NOW - H}
        now={NOW}
        oldest={NOW - 1000 * H}
      />,
    )
    // Centred on the new window again: three hours around it, up to now.
    expect(extent()).toEqual([NOW - 3 * H, NOW])
  })

  test("never back past the oldest stored Post", async () => {
    mount(NOW - 4 * H)
    for (const _ of [1, 2, 3, 4, 5])
      fireEvent.keyDown(scrollbar(), { key: "ArrowLeft" })
    await settle()
    expect(extent()).toEqual([NOW - 4 * H, NOW - H])
  })

  test("its scrollbar runs from the oldest stored Post to now", () => {
    mount(NOW - 30 * H)
    // Three hours of thirty, at the end.
    expect(at()).toBe(90)
    const style = scrollbar().getAttribute("style") ?? ""
    expect(style).toContain("width: 10%")
    cleanup()
    // Without an oldest Post, or with all of it shown, there is no scrollbar.
    mount(null)
    expect(screen.queryByRole("scrollbar")).toBeNull()
    cleanup()
    mount(NOW - 2 * H)
    expect(screen.queryByRole("scrollbar")).toBeNull()
  })
})
