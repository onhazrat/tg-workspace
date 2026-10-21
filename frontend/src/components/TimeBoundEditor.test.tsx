/**
 * A Time bound on the one editor (TB-01, ADR-033), from the outside: type
 * into the Analysis window editor's four fields over a Time bound and read
 * the bound it emits. Open ends, an End ahead of now and No value are the
 * caller's switches; drafts and errors are the Posts editor's.
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
import { useState } from "react"
import { TimeBoundBar, TimeBoundEditor } from "@/components/TimeBoundEditor"
import type { TimeBound, TimeBoundOptions } from "@/lib/time-bound/bound"

const MINUTE = 60_000
const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 20, 12, 0)

beforeEach(() => {
  setSystemTime(new Date(NOW))
})

afterEach(() => {
  cleanup()
  setSystemTime()
})

function Harness({
  initial,
  opts,
  noValue,
  emitted,
  bar,
}: {
  initial: TimeBound
  opts: TimeBoundOptions
  noValue?: boolean
  emitted: TimeBound[]
  bar?: boolean
}) {
  const [bound, setBound] = useState(initial)
  const [none, setNone] = useState(false)
  const onChange = (next: TimeBound) => {
    emitted.push(next)
    setBound(next)
  }
  if (bar)
    return (
      <TimeBoundBar
        label="Logged"
        value={bound}
        onChange={onChange}
        opts={opts}
      />
    )
  return (
    <TimeBoundEditor
      value={bound}
      onChange={onChange}
      opts={opts}
      modeLabel="Last post mode"
      noValue={noValue ? { on: none, onChange: setNone } : undefined}
    />
  )
}

function mount(
  initial: TimeBound,
  opts: TimeBoundOptions = {},
  extra: { noValue?: boolean; bar?: boolean } = {},
) {
  const emitted: TimeBound[] = []
  render(<Harness initial={initial} opts={opts} emitted={emitted} {...extra} />)
  return emitted
}

const field = (label: string) =>
  screen.getByLabelText(label) as HTMLInputElement

const typeAndCommit = (label: string, text: string) => {
  act(() => {
    fireEvent.change(field(label), { target: { value: text } })
    fireEvent.keyDown(field(label), { key: "Enter" })
  })
}

const alert = () => screen.queryByRole("alert")?.textContent

describe("open ends", () => {
  test("a blank End leaves that end open where open ends are allowed", () => {
    const emitted = mount(
      { mode: "live", start: -7 * DAY, end: 0 },
      { openEnds: true },
    )
    typeAndCommit("End", "")
    expect(emitted).toEqual([{ mode: "live", start: -7 * DAY }])
    expect(field("End").value).toBe("")
    expect(field("Duration").value).toBe("")
    expect(field("End gap").value).toBe("")
  })

  test("a blank End is refused where they are not", () => {
    const emitted = mount({ mode: "live", start: -7 * DAY, end: 0 })
    typeAndCommit("End", "")
    expect(emitted).toEqual([])
    expect(alert()).toBe("Use a date and time.")
  })

  test("Duration with both ends open ends it now", () => {
    const emitted = mount({ mode: "live" }, { openEnds: true })
    typeAndCommit("Duration", "3d")
    expect(emitted).toEqual([{ mode: "live", start: -3 * DAY, end: 0 }])
  })

  test("Duration with only Start set moves the End", () => {
    const emitted = mount(
      { mode: "fixed", start: NOW - 10 * DAY },
      { openEnds: true },
    )
    typeAndCommit("Duration", "2d")
    expect(emitted).toEqual([
      { mode: "fixed", start: NOW - 10 * DAY, end: NOW - 8 * DAY },
    ])
  })
})

describe("ahead of now", () => {
  test("a negative End gap ends ahead of now, keeping the Duration", () => {
    const emitted = mount(
      { mode: "live", start: -DAY, end: 0 },
      { ahead: true },
    )
    typeAndCommit("End gap", "-2d")
    expect(emitted).toEqual([{ mode: "live", start: DAY, end: 2 * DAY }])
    expect(field("End gap").value).toBe("-2d")
  })

  test("a negative End gap is refused where ahead is not allowed", () => {
    const emitted = mount({ mode: "live", start: -DAY, end: 0 })
    typeAndCommit("End gap", "-2d")
    expect(emitted).toEqual([])
    expect(alert()).toContain("whole minutes")
  })

  test("an End typed past now is refused where ahead is not allowed", () => {
    const emitted = mount({ mode: "fixed", start: NOW - DAY, end: NOW })
    const later = new Date(NOW + DAY)
    const pad = (n: number) => String(n).padStart(2, "0")
    typeAndCommit(
      "End",
      `${later.getFullYear()}-${pad(later.getMonth() + 1)}-${pad(later.getDate())}T${pad(later.getHours())}:${pad(later.getMinutes())}`,
    )
    expect(emitted).toEqual([])
    expect(alert()).toBe("End cannot be later than the current minute.")
  })
})

describe("the fields", () => {
  test("Start and End are instants in either mode; Fixed stores them", () => {
    const emitted = mount({ mode: "fixed" }, { openEnds: true })
    expect(field("Start").getAttribute("type")).toBe("datetime-local")
    typeAndCommit("Start", "2026-10-01T09:30")
    expect(emitted).toEqual([
      { mode: "fixed", start: new Date("2026-10-01T09:30").getTime() },
    ])
  })

  test("an End before the Start is refused, not swapped", () => {
    const emitted = mount(
      { mode: "fixed", start: new Date("2026-10-10T00:00").getTime() },
      { openEnds: true },
    )
    typeAndCommit("End", "2026-10-01T00:00")
    expect(emitted).toEqual([])
    expect(alert()).toBe("Duration must be at least 1 minute.")
  })

  test("an invalid draft stays on screen with the Posts editor's error", () => {
    const emitted = mount({ mode: "live", start: -DAY, end: 0 })
    typeAndCommit("Duration", "half a day")
    expect(emitted).toEqual([])
    expect(field("Duration").value).toBe("half a day")
    expect(field("Duration").getAttribute("aria-invalid")).toBe("true")
    expect(alert()).toContain("whole minutes")
  })

  test("a shortcut sets the focused elapsed field", () => {
    const emitted = mount({ mode: "live" }, { openEnds: true })
    act(() => {
      fireEvent.focus(field("Duration"))
    })
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "7d" }))
    })
    expect(emitted).toEqual([{ mode: "live", start: -7 * DAY, end: 0 }])
  })

  test("switching mode keeps both ends where they are", () => {
    const emitted = mount({ mode: "live", start: -DAY, end: -MINUTE })
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Fixed" }))
    })
    expect(emitted).toEqual([
      { mode: "fixed", start: NOW - DAY, end: NOW - MINUTE },
    ])
  })
})

describe("No value", () => {
  test("is a third segment that hides the fields", () => {
    mount({ mode: "live", start: -DAY }, { openEnds: true }, { noValue: true })
    const choice = screen.getByRole("group", { name: "Last post mode" })
    expect(choice.textContent).toBe("LiveFixedNo value")
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "No value" }))
    })
    expect(screen.queryByLabelText("Start")).toBeNull()
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Live" }))
    })
    expect(field("Start")).toBeTruthy()
  })

  test("is offered only when the caller asks for it", () => {
    mount({ mode: "live", start: -DAY }, { openEnds: true })
    expect(screen.queryByRole("button", { name: "No value" })).toBeNull()
  })
})

describe("the bar", () => {
  const trigger = () => screen.getByRole("button", { name: "Logged" })

  test("an empty Time bound reads Any time", () => {
    mount({ mode: "live" }, { openEnds: true }, { bar: true })
    expect(trigger().textContent).toBe("Any time")
  })

  test("opens the same editor, and its line follows the bound", () => {
    mount(
      { mode: "live", start: -DAY, end: 0 },
      { openEnds: true },
      { bar: true },
    )
    expect(trigger().textContent).toBe("Live · 1d ago → now (1d)")
    act(() => {
      fireEvent.click(trigger())
    })
    typeAndCommit("Duration", "3d")
    expect(trigger().textContent).toBe("Live · 3d ago → now (3d)")
  })
})
