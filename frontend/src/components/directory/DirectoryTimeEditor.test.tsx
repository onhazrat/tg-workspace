/**
 * The Time bound editor (DPF), props-only: Live or Fixed like the Analysis
 * window, either end left open, a Live end ago or ahead, a Fixed end typed in
 * the viewer's own zone, the no-value switch, the spread's bars, and the count
 * preview on Add.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { DirectoryDistributionResponse } from "@/client"
import {
  type DirectoryTimeCond,
  type MomentKey,
  momentOf,
} from "@/lib/directory/directory-filter"
import { DirectoryTimeEditor } from "./DirectoryTimeEditor"

afterEach(cleanup)

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
const input = (label: string) =>
  screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement
const type = (label: string, value: string) =>
  fireEvent.change(input(label), { target: { value } })

describe("the Time bound editor", () => {
  test("a Live end ahead with the start left open", () => {
    const { submitted, previewed } = mount()
    expect(submit()).toHaveProperty("disabled", true)
    type("End amount", "2")
    type("End unit", "d")
    type("End direction", "ahead")
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

  test("a Live start ago, and now as an end", () => {
    const { submitted } = mount({ moment: "last_post_at" })
    type("Start amount", "7")
    type("Start unit", "d")
    type("End amount", "0")
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
    fireEvent.click(screen.getByRole("button", { name: "Fixed" }))
    type("Start", "2026-10-01T09:30")
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

  test("an end before the start cannot be added", () => {
    mount()
    type("Start amount", "1")
    type("Start direction", "ahead")
    type("End amount", "1")
    type("End direction", "ago")
    expect(submit()).toHaveProperty("disabled", true)
  })

  test("a bar sets a Fixed range over it", () => {
    const { submitted } = mount()
    fireEvent.click(screen.getByTestId("directory-bound-bar-1"))
    fireEvent.click(submit())
    expect(submitted).toEqual([
      {
        type: "time",
        moment: "refresh_due_at",
        mode: "fixed",
        start: Date.UTC(2026, 0, 2),
        end: Date.UTC(2026, 0, 3),
      },
    ])
  })

  test("no value needs no end, and editing says Update", () => {
    const { submitted } = mount({
      initial: {
        type: "time",
        moment: "refresh_due_at",
        mode: "live",
        start: 0,
      },
    })
    expect(input("Start amount").value).toBe("0")
    fireEvent.click(screen.getByRole("button", { name: "No value" }))
    expect(submit().textContent).toBe("Update · 3 channels")
    fireEvent.click(submit())
    expect(submitted).toEqual([
      { type: "time", moment: "refresh_due_at", mode: "live", none: true },
    ])
  })
})
