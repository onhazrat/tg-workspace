/**
 * A Channel moment's Time bound editor (TB-03), props-only: the moment's
 * spread drawn from the Channels already loaded, the one editor with open
 * ends, an End ahead of now and No value, and Add or Update with the count
 * it keeps.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { TimeCond } from "@/lib/channels/channel-filter"
import type { MetricData } from "@/lib/channels/channel-metrics"
import { ChannelTimeEditor } from "./ChannelTimeEditor"

const NOW = Date.UTC(2026, 9, 20, 12, 0)
const MIN = 60_000
const DAY = 86_400_000

// Five of six Channels followed: two inside one minute ten days ago, the
// rest over the last two days.
const FOLLOWED = [
  NOW - 10 * DAY + 30_000,
  NOW - 10 * DAY + 45_000,
  NOW - 2 * DAY,
  NOW - DAY,
  NOW - DAY + 10 * MIN,
]

beforeEach(() => {
  setSystemTime(new Date(NOW))
})

afterEach(() => {
  cleanup()
  setSystemTime()
})

function mount({
  initial,
  moments = FOLLOWED,
}: {
  initial?: TimeCond
  moments?: number[]
} = {}) {
  const submitted: TimeCond[] = []
  const data: MetricData = {
    values: () => [],
    total: 6,
    moments: () => moments,
  }
  render(
    <ChannelTimeEditor
      momentKey="followed_at"
      data={data}
      initial={initial}
      onSubmit={(cond) => submitted.push(cond)}
    />,
  )
  return submitted
}

const submit = () => screen.getByTestId("channel-time-submit")
const bars = () => screen.getAllByTestId(/^spread-bar-/)
/** How many Channels a bar counts, as its caption says on hover. */
const countOf = (bar: HTMLElement) => {
  fireEvent.pointerEnter(bar)
  const middle = screen.getByTestId("spread-caption").children[1]
  return Number(/^(\d+) channels/.exec(middle.textContent ?? "")?.[1])
}
/** A click on a bar: a one-bar run. */
const pick = (bar: HTMLElement) => {
  fireEvent.pointerDown(bar)
  fireEvent.pointerUp(bar)
}
const click = (name: string) => {
  act(() => {
    fireEvent.click(screen.getByRole("button", { name }))
  })
}

describe("ChannelTimeEditor", () => {
  test("names the moment, and Add stays off while the bound is Any time", () => {
    mount()
    expect(screen.getByText("Followed")).toBeTruthy()
    expect(screen.getByText("When you followed it.")).toBeTruthy()
    expect(
      screen.getByRole("group", { name: "Followed mode" }).textContent,
    ).toBe("LiveFixedNo value")
    expect(submit()).toHaveProperty("disabled", true)
  })

  test("a Duration shortcut emits a Live bound and counts what it keeps", () => {
    const submitted = mount()
    act(() => {
      fireEvent.focus(screen.getByLabelText("Duration"))
    })
    click("7d")
    expect(submit().textContent).toBe("Add · 3 of 5 with a value")
    fireEvent.click(submit())
    expect(submitted).toEqual([
      {
        type: "time",
        moment: "followed_at",
        mode: "live",
        start: -7 * DAY,
        end: 0,
      },
    ])
  })

  test("a picked bar keeps exactly the Channels it counts", () => {
    mount()
    const counted = bars().filter((b) => countOf(b) > 0)
    expect(counted.length).toBeGreaterThan(1)
    for (const bar of counted) {
      const count = countOf(bar)
      pick(bar)
      expect(submit().textContent).toBe(`Add · ${count} of 5 with a value`)
    }
  })

  test("a pick is a Fixed bound out to whole minutes, its End past the newest value", () => {
    const submitted = mount()
    // The second filled bar: neither edge of the spread, so both ends set.
    const second = bars().filter((b) => countOf(b) > 0)[1]
    pick(second)
    fireEvent.click(submit())
    const [cond] = submitted
    expect(cond.mode).toBe("fixed")
    expect((cond.start ?? 0) % MIN).toBe(0)
    expect((cond.end ?? 0) % MIN).toBe(0)
    expect(submit().textContent).toBe(
      `Add · ${countOf(second)} of 5 with a value`,
    )
  })

  test("a pick touching the first bar leaves the start open", () => {
    const submitted = mount()
    pick(bars()[0])
    fireEvent.click(submit())
    expect(submitted).toEqual([
      {
        type: "time",
        moment: "followed_at",
        mode: "fixed",
        end: NOW - 10 * DAY + MIN,
      },
    ])
  })

  test("No value keeps the Channels with none, and editing says Update", () => {
    const submitted = mount({
      initial: {
        type: "time",
        moment: "followed_at",
        mode: "live",
        start: -DAY,
      },
    })
    click("No value")
    expect(submit().textContent).toBe("Update · 1 with no value")
    fireEvent.click(submit())
    expect(submitted).toEqual([
      { type: "time", moment: "followed_at", mode: "live", none: true },
    ])
  })

  describe("zoom (TB-04)", () => {
    const counted = () => bars().reduce((sum, b) => sum + countOf(b), 0)
    const caption = () => screen.getByTestId("spread-caption").textContent
    const disabled = (name: string) =>
      (screen.getByRole("button", { name }) as HTMLButtonElement).disabled
    const time = /\d:\d\d/

    test("re-bins in the browser around the median, clamped inside the spread", () => {
      mount()
      expect(counted()).toBe(5)
      expect(disabled("Zoom out")).toBe(true)
      // A third of nine days around two days ago runs into the newest
      // value, so it ends there: the three of the last four days.
      click("Zoom in")
      expect(counted()).toBe(3)
      expect(bars()).toHaveLength(32)
      // A third again, about a day around the median: that one alone.
      click("Zoom in")
      expect(counted()).toBe(1)
      click("Zoom out")
      click("Zoom out")
      expect(counted()).toBe(5)
      expect(disabled("Zoom out")).toBe(true)
    })

    test("centres on the bound", () => {
      mount({
        initial: {
          type: "time",
          moment: "followed_at",
          mode: "fixed",
          start: NOW - 11 * DAY,
          end: NOW - 9 * DAY,
        },
      })
      click("Zoom in")
      // Three days from the oldest: the two followed ten days ago.
      expect(counted()).toBe(2)
    })

    test("a zoomed bar still keeps exactly the Channels it counts", () => {
      mount()
      click("Zoom in")
      for (const bar of bars().filter((b) => countOf(b) > 0)) {
        const count = countOf(bar)
        pick(bar)
        expect(submit().textContent).toBe(`Add · ${count} of 5 with a value`)
      }
    })

    test("the captions show the time of day once under three days show", () => {
      mount()
      expect(caption()).not.toMatch(time)
      click("Zoom in")
      expect(caption()).not.toMatch(time)
      click("Zoom in")
      expect(caption()).toMatch(time)
    })

    test("a spread under three days whole shows the time of day too", () => {
      mount({ moments: [NOW - DAY, NOW - DAY / 2] })
      expect(caption()).toMatch(time)
    })
  })

  test("with no value anywhere there is no spread to draw", () => {
    mount({ moments: [] })
    expect(screen.queryAllByTestId(/^spread-bar-/)).toHaveLength(0)
    expect(
      screen.getByText("None of your channels has a value yet."),
    ).toBeTruthy()
  })
})
