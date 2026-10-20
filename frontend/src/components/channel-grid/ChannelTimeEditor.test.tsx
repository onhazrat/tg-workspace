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
const bars = () => screen.getAllByTestId(/^directory-bound-bar-/)
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

  test("a clicked bar keeps exactly the Channels it counts", () => {
    mount()
    const counted = bars().filter((b) => !b.title.endsWith(": 0 channels"))
    expect(counted.length).toBeGreaterThan(1)
    for (const bar of counted) {
      const count = Number(/: (\d+) channels$/.exec(bar.title)?.[1])
      fireEvent.click(bar)
      expect(submit().textContent).toBe(`Add · ${count} of 5 with a value`)
    }
  })

  test("a clicked bar is a Fixed bound out to whole minutes, its End past the newest value", () => {
    const submitted = mount()
    fireEvent.click(bars()[0])
    fireEvent.click(submit())
    expect(submitted).toEqual([
      {
        type: "time",
        moment: "followed_at",
        mode: "fixed",
        start: NOW - 10 * DAY,
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

  test("with no value anywhere there is no spread to draw", () => {
    mount({ moments: [] })
    expect(screen.queryAllByTestId(/^directory-bound-bar-/)).toHaveLength(0)
    expect(
      screen.getByText("None of your channels has a value yet."),
    ).toBeTruthy()
  })
})
