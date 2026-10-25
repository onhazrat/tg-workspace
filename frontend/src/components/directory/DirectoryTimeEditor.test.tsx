/**
 * The Directory's Time bound editor (DPF, TB-01), props-only: the moment's
 * name and spread, the Analysis window editor with open ends, an End ahead of
 * now and No value, and Add or Update with the count preview.
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
import type { DirectoryDistributionResponse } from "@/client"
import { useZoomState } from "@/components/SpreadZoom"
import {
  type DirectoryTimeCond,
  type MomentKey,
  momentOf,
} from "@/lib/directory/directory-filter"
import type { Range } from "@/lib/spread"
import { DirectoryTimeEditor } from "./DirectoryTimeEditor"

const NOW = Date.UTC(2026, 9, 20, 12, 0)

beforeEach(() => {
  setSystemTime(new Date(NOW))
})

afterEach(() => {
  cleanup()
  setSystemTime()
})

const DAY = 86_400_000

const SPREAD: DirectoryDistributionResponse = {
  scale: "linear",
  total: 10,
  noValue: 4,
  min: Date.UTC(2026, 0, 1),
  max: Date.UTC(2026, 0, 3),
  median: Date.UTC(2026, 0, 2),
  bins: [
    { lo: Date.UTC(2026, 0, 1), hi: Date.UTC(2026, 0, 2), count: 2 },
    { lo: Date.UTC(2026, 0, 2), hi: Date.UTC(2026, 0, 3), count: 4 },
  ],
}

function mount({
  moment = "refresh_due_at" as MomentKey,
  initial,
}: {
  moment?: MomentKey
  initial?: DirectoryTimeCond
} = {}) {
  const submitted: DirectoryTimeCond[] = []
  const previewed: DirectoryTimeCond[] = []
  render(
    <DirectoryTimeEditor
      moment={momentOf(moment)}
      initial={initial}
      distribution={SPREAD}
      countFor={(cond) => {
        previewed.push(cond)
        return " · 3 channels"
      }}
      onSubmit={(cond) => submitted.push(cond)}
    />,
  )
  return { submitted, previewed }
}

const submit = () => screen.getByTestId("directory-time-submit")
const field = (label: string) =>
  screen.getByLabelText(label) as HTMLInputElement
const typeAndCommit = (label: string, text: string) => {
  act(() => {
    fireEvent.change(field(label), { target: { value: text } })
    fireEvent.keyDown(field(label), { key: "Enter" })
  })
}
const click = (name: string) => {
  act(() => {
    fireEvent.click(screen.getByRole("button", { name }))
  })
}

describe("the Time bound editor", () => {
  test("is the Analysis window editor; the old fields are gone", () => {
    mount()
    for (const label of ["Start", "End", "Duration", "End gap"])
      expect(field(label)).toBeTruthy()
    expect(screen.queryByLabelText("End amount")).toBeNull()
    expect(screen.queryByLabelText("End direction")).toBeNull()
    expect(
      screen.getByRole("group", { name: "Refresh due mode" }).textContent,
    ).toBe("LiveFixedNo value")
  })

  test("a Live End ahead of now with the Start left open", () => {
    const { submitted, previewed } = mount()
    expect(submit()).toHaveProperty("disabled", true)
    typeAndCommit("End gap", "-2d")
    expect(submit().textContent).toBe("Add · 3 channels")
    fireEvent.click(submit())
    const want: DirectoryTimeCond = {
      type: "time",
      moment: "refresh_due_at",
      mode: "live",
      end: 2 * DAY,
    }
    expect(submitted).toEqual([want])
    expect(previewed.at(-1)).toEqual(want)
  })

  test("a Duration from now, as a shortcut", () => {
    const { submitted } = mount({ moment: "last_post_at" })
    act(() => {
      fireEvent.focus(field("Duration"))
    })
    click("7d")
    fireEvent.click(submit())
    expect(submitted).toEqual([
      {
        type: "time",
        moment: "last_post_at",
        mode: "live",
        start: -7 * DAY,
        end: 0,
      },
    ])
  })

  test("a Fixed end is read in the viewer's zone and sent as an instant", () => {
    const { submitted } = mount({ moment: "checked_at" })
    click("Fixed")
    typeAndCommit("Start", "2026-10-01T09:30")
    fireEvent.click(submit())
    expect(submitted).toEqual([
      {
        type: "time",
        moment: "checked_at",
        mode: "fixed",
        start: new Date("2026-10-01T09:30").getTime(),
      },
    ])
  })

  test("an End before the Start is refused, and cannot be added", () => {
    mount()
    click("Fixed")
    typeAndCommit("Start", "2026-10-10T00:00")
    typeAndCommit("End", "2026-10-01T00:00")
    expect(screen.getByRole("alert").textContent).toBe(
      "Duration must be at least 1 minute.",
    )
    expect(field("End").value).toBe("2026-10-01T00:00")
  })

  const pick = (from: number, to = from) => {
    fireEvent.pointerDown(screen.getByTestId(`spread-bar-${from}`))
    if (to !== from)
      fireEvent.pointerEnter(screen.getByTestId(`spread-bar-${to}`))
    fireEvent.pointerUp(screen.getByTestId(`spread-bar-${to}`))
  }

  test.each([
    {
      name: "the first bar leaves the start open",
      run: [0],
      end: { end: Date.UTC(2026, 0, 2) },
    },
    {
      name: "the last bar leaves the end open",
      run: [1],
      end: { start: Date.UTC(2026, 0, 2) },
    },
    {
      name: "both keep everything with a value",
      run: [0, 1],
      end: { start: Date.UTC(2026, 0, 1) },
    },
  ])("a pick touching $name", ({ run, end }) => {
    const { submitted } = mount()
    pick(run[0], run[1])
    fireEvent.click(submit())
    expect(submitted).toEqual([
      { type: "time", moment: "refresh_due_at", mode: "fixed", ...end },
    ])
  })

  test("an existing bound opens in the fields, with its open end blank", () => {
    mount({
      initial: {
        type: "time",
        moment: "last_post_at",
        mode: "live",
        start: -7 * DAY,
      },
    })
    expect(field("Start").value).not.toBe("")
    expect(field("End").value).toBe("")
    expect(field("Duration").value).toBe("")
  })

  test("clearing an End leaves that end open", () => {
    const { submitted } = mount({
      moment: "last_post_at",
      initial: {
        type: "time",
        moment: "last_post_at",
        mode: "live",
        start: -7 * DAY,
        end: 0,
      },
    })
    typeAndCommit("End", "")
    fireEvent.click(submit())
    expect(submitted).toEqual([
      { type: "time", moment: "last_post_at", mode: "live", start: -7 * DAY },
    ])
  })

  test("No value hides the fields, needs no end, and editing says Update", () => {
    const { submitted } = mount({
      initial: {
        type: "time",
        moment: "refresh_due_at",
        mode: "live",
        start: 0,
      },
    })
    click("No value")
    expect(screen.queryByLabelText("Start")).toBeNull()
    expect(submit().textContent).toBe("Update · 3 channels")
    fireEvent.click(submit())
    expect(submitted).toEqual([
      { type: "time", moment: "refresh_due_at", mode: "live", none: true },
    ])
  })

  test("a No value Condition opens on No value", () => {
    mount({
      initial: {
        type: "time",
        moment: "refresh_due_at",
        mode: "fixed",
        none: true,
      },
    })
    expect(screen.queryByLabelText("Start")).toBeNull()
    expect(
      screen
        .getByRole("button", { name: "No value" })
        .getAttribute("aria-pressed"),
    ).toBe("true")
  })
})

describe("zoom (TB-04)", () => {
  test("asks for a third of the spread around the bound", () => {
    const asked: (Range | null)[] = []
    function Container() {
      const zoom = useZoomState()
      asked.push(zoom.range)
      return (
        <DirectoryTimeEditor
          moment={momentOf("refresh_due_at")}
          initial={{
            type: "time",
            moment: "refresh_due_at",
            mode: "fixed",
            start: SPREAD.min ?? 0,
            end: (SPREAD.min ?? 0) + DAY / 2,
          }}
          distribution={SPREAD}
          zoom={zoom}
          countFor={() => null}
          onSubmit={() => {}}
        />
      )
    }
    render(<Container />)
    click("Zoom in")
    // Two days in thirds is 16 hours, held inside the spread at its start.
    const start = SPREAD.min ?? 0
    expect(asked.at(-1)).toEqual([start, start + (2 * DAY) / 3])
  })
})
