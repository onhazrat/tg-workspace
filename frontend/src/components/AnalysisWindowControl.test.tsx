/**
 * The one Analysis-window editor (AW-04), from the outside.
 *
 * The propagation matrix is `lib/scope/window.test.ts` and the drafts and the
 * clock are `contexts/ScopeContext.test.tsx`. What is left for this file is the
 * part a person touches: that one trigger carries the whole window, that the
 * four fields are reachable and labelled, that the shortcut row belongs to
 * whichever elapsed field has focus, and that a change does not close the thing
 * being changed.
 *
 * Queries are by role and label, never by class, because the styling here is
 * the half most likely to be rewritten.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"

import {
  AnalysisWindowControl,
  stampText,
  WindowHistogramContext,
  WindowOldestPostContext,
} from "@/components/AnalysisWindowControl"
import { ScopeProvider, useScope } from "@/contexts/ScopeContext"
import type { WindowHistogramQuery } from "@/lib/analysis-window"
import { DAY_MS, formatLocalMinute, HOUR_MS } from "@/lib/scope/window"

const NOW = Date.UTC(2026, 8, 11, 14, 30)

function renderControl() {
  return render(
    <ScopeProvider clock={() => NOW}>
      <AnalysisWindowControl />
    </ScopeProvider>,
  )
}

/** The collapsed control, which is the only way into the editor. */
const trigger = () => screen.getByRole("button", { name: "Analysis window" })

const open = () => {
  act(() => {
    fireEvent.click(trigger())
  })
}

const field = (label: string) => screen.getByLabelText(label)

const value = (label: string) => (field(label) as HTMLInputElement).value

const typeAndCommit = (label: string, text: string) => {
  const input = field(label)
  act(() => {
    fireEvent.change(input, { target: { value: text } })
    fireEvent.keyDown(input, { key: "Enter" })
  })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(cleanup)

describe("the collapsed trigger", () => {
  test("carries mode, both boundaries and Duration", () => {
    renderControl()

    expect(trigger().textContent).toContain("Live · 1d ago → now (1d)")
  })

  test("the editor is behind it, not beside it", () => {
    renderControl()

    expect(screen.queryByLabelText("Duration")).toBeNull()

    open()

    expect(screen.getByLabelText("Duration")).toBeTruthy()
  })
})

describe("the four fields", () => {
  test("all four are present and programmatically labelled", () => {
    renderControl()
    open()

    for (const label of ["Start", "End", "Duration", "End gap"]) {
      expect(field(label)).toBeTruthy()
    }
  })

  test("both boundaries are exact local instants in either mode", () => {
    renderControl()
    open()

    // Live used to show `1d` here — the offset it stores rather than the
    // boundary it means — and got a bare text box to type an offset back into.
    const asTyped = value("Start")
    expect(asTyped).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    expect(field("Start").getAttribute("type")).toBe("datetime-local")

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Fixed" }))
    })

    // Freezing changes none of the four values, so the boundary reads the same.
    expect(value("Start")).toBe(asTyped)
    expect(field("Start").getAttribute("type")).toBe("datetime-local")
    // Duration is elapsed in both modes, and always on screen.
    expect(value("Duration")).toBe("1d")
    expect(field("Duration").getAttribute("type")).toBe("text")
  })

  test("a refusal lands on the field that earned it, and is announced", () => {
    renderControl()
    open()

    typeAndCommit("Duration", "half a day")

    const error = screen.getByRole("alert")
    expect(error.textContent).toContain("whole minutes")
    expect(field("Duration").getAttribute("aria-describedby")).toBe(error.id)
    expect(field("Duration").getAttribute("aria-invalid")).toBe("true")
    // The committed window is untouched.
    expect(trigger().textContent).toContain("(1d)")
  })
})

describe("the shortcut row", () => {
  test("appears for whichever elapsed field has focus, and for neither otherwise", () => {
    renderControl()
    open()

    expect(screen.queryByRole("button", { name: "30d" })).toBeNull()

    act(() => {
      fireEvent.focus(field("Duration"))
    })
    expect(screen.getByRole("button", { name: "30d" })).toBeTruthy()

    // A boundary is not an elapsed field, so the row has nothing to apply to.
    act(() => {
      fireEvent.focus(field("Start"))
    })
    expect(screen.queryByRole("button", { name: "30d" })).toBeNull()
  })

  test("it goes away when the field it belonged to loses focus", () => {
    renderControl()
    open()

    act(() => {
      fireEvent.focus(field("Duration"))
    })
    expect(screen.getByRole("button", { name: "30d" })).toBeTruthy()

    // Clicking the mode switch blurs the input without focusing another one. A
    // row left behind would apply to a field nothing on screen still points at.
    act(() => {
      fireEvent.blur(field("Duration"))
    })

    expect(screen.queryByRole("button", { name: "30d" })).toBeNull()
  })

  test("zero is typeable but is not one of the shortcuts", () => {
    renderControl()
    open()

    act(() => {
      fireEvent.focus(field("End gap"))
    })
    expect(screen.queryByRole("button", { name: "0m" })).toBeNull()

    typeAndCommit("End gap", "0m")
    expect(trigger().textContent).toContain("→ now")
  })

  test("a Duration shortcut keeps the End gap it found", () => {
    renderControl()
    open()

    typeAndCommit("End gap", "30m")
    expect(trigger().textContent).toContain("Live · 1d 30m ago → 30m ago (1d)")

    act(() => {
      fireEvent.focus(field("Duration"))
    })
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "3h" }))
    })

    // The gap survived: resizing a deliberately delayed window must not drag
    // its end back to now.
    expect(trigger().textContent).toContain("Live · 3h 30m ago → 30m ago (3h)")
  })
})

describe("disclosure", () => {
  test("the editor stays open after a valid change", () => {
    renderControl()
    open()

    typeAndCommit("Duration", "3h")

    expect(trigger().textContent).toContain("(3h)")
    expect(screen.getByLabelText("Duration")).toBeTruthy()
  })

  test("Escape closes it and returns focus to the trigger", async () => {
    renderControl()
    open()

    act(() => {
      fireEvent.keyDown(field("Duration"), { key: "Escape" })
    })
    // The return happens on unmount, a frame after the close.
    await act(() => new Promise((done) => setTimeout(done, 0)))

    expect(screen.queryByLabelText("Duration")).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  test("closing commits a finished draft the field never got to blur", () => {
    renderControl()
    open()

    // No Enter, no blur, and inside the 400 ms debounce — which is what an
    // outside click looks like, because the dismiss runs on `pointerdown`.
    act(() => {
      fireEvent.change(field("Duration"), { target: { value: "3h" } })
      fireEvent.keyDown(field("Duration"), { key: "Escape" })
    })

    expect(trigger().textContent).toContain("(3h)")
  })

  test("closing throws an unfinished draft away rather than committing it", () => {
    renderControl()
    open()

    act(() => {
      fireEvent.change(field("Duration"), { target: { value: "3" } })
      fireEvent.keyDown(field("Duration"), { key: "Escape" })
    })

    expect(trigger().textContent).toContain("(1d)")

    open()
    expect(value("Duration")).toBe("1d")
  })
})

describe("the mobile presentation", () => {
  /**
   * An anchored 26rem popover does not fit a phone, so a narrow viewport gets a
   * bottom sheet. The sheet is a dialog, which is what contains focus while it
   * is open — the one accessibility property the desktop popover deliberately
   * does not have.
   */
  const setWidth = (px: number) => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: px,
    })
  }

  afterEach(() => setWidth(1024))

  test("a narrow viewport gets a dialog rather than an anchored popover", () => {
    setWidth(420)
    renderControl()
    open()

    const dialog = screen.getByRole("dialog")
    expect(dialog.getAttribute("data-slot")).toBe("sheet-content")
    // The same editor, not a second one: the four fields come from the module
    // the popover renders too.
    for (const label of ["Start", "End", "Duration", "End gap"]) {
      expect(field(label)).toBeTruthy()
    }
  })
})

/**
 * The editor opening because another surface asked it to (AW-09).
 *
 * Action draws the window read-only and hands the editing here, so the request
 * has to survive a navigation and arrive at a component that was not mounted
 * when it was made. Both halves of that are load-bearing: it must open on
 * arrival, and it must be *spent* — a request left standing would reopen the
 * popover every later time somebody walked onto Posts.
 *
 * `AnalysisWindowLink` itself is not rendered here. It needs `UIProvider` for
 * the tab hop, and what that hop is worth is a browser question; what is
 * testable at this seam is the half the editor owns.
 */
describe("a request from another surface", () => {
  /** Stands in for Action: asks, then goes away, exactly as the tab does. */
  const Requester: React.FC = () => {
    const { requestEditor } = useScope()
    return (
      <button type="button" onClick={requestEditor}>
        ask
      </button>
    )
  }

  /** The control unmounts and remounts, because leaving Posts is what that is. */
  const Remountable: React.FC = () => {
    const [mounted, setMounted] = useState(true)
    return (
      <>
        <button type="button" onClick={() => setMounted((on) => !on)}>
          toggle posts
        </button>
        {mounted && (
          <AnalysisWindowControl onReturnToAction={() => setMounted(false)} />
        )}
      </>
    )
  }

  const renderPair = () =>
    render(
      <ScopeProvider clock={() => NOW}>
        <Requester />
        <Remountable />
      </ScopeProvider>,
    )

  const ask = () =>
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "ask" }))
    })

  const toggle = () =>
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "toggle posts" }))
    })

  test("opens the one editor, with the way back", () => {
    renderPair()
    expect(screen.queryByLabelText("Duration")).toBeNull()

    ask()

    expect(screen.getByLabelText("Duration")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Back to Action" })).toBeTruthy()
  })

  test("the request is spent, so a later arrival finds it closed", () => {
    renderPair()
    ask()
    expect(screen.getByLabelText("Duration")).toBeTruthy()

    // Leave Posts, come back.
    toggle()
    toggle()

    expect(screen.queryByLabelText("Duration")).toBeNull()
  })

  test("leaving by the button still throws an invalid draft away", () => {
    renderPair()
    ask()

    // `abc` is refused, so it lives on as a draft with an error beside it.
    typeAndCommit("Duration", "abc")
    expect(screen.getByRole("alert")).toBeTruthy()

    // The tab change unmounts this without Radix ever seeing a close, so the
    // return has to go out through the same door every other close does.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Back to Action" }))
    })

    toggle()
    open()
    expect(value("Duration")).toBe("1d")
    expect(screen.queryByRole("alert")).toBeNull()
  })

  test("opening it by hand offers no way back to a tab nobody came from", () => {
    renderPair()

    open()

    expect(screen.getByLabelText("Duration")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Back to Action" })).toBeNull()
  })
})

describe("the chart (PTI-03)", () => {
  /** A fake read: every query it was asked, and bucket `i` holding `i` Posts. */
  function renderCharted(oldest: number | null = null) {
    const asked: WindowHistogramQuery[] = []
    const read = (q: WindowHistogramQuery) => {
      asked.push(q)
      return Array.from({ length: q.buckets }, (_, i) => i)
    }
    render(
      <ScopeProvider clock={() => NOW}>
        <WindowHistogramContext.Provider value={read}>
          <WindowOldestPostContext.Provider value={oldest}>
            <AnalysisWindowControl />
          </WindowOldestPostContext.Provider>
        </WindowHistogramContext.Provider>
      </ScopeProvider>,
    )
    return { last: () => asked[asked.length - 1] }
  }

  const bar = (i: number) => screen.getByTestId(`window-bar-${i}`)
  const solid = () =>
    screen
      .getAllByTestId(/^window-bar-/)
      .flatMap((el, i) => (el.dataset.solid === "true" ? [i] : []))

  test("three times the window, centred on it but never past now, the window solid", () => {
    const { last } = renderCharted()
    open()

    // The default Live day ends now, so the chart is the three days before it.
    expect(last()).toEqual({
      extentStart: NOW - 3 * DAY_MS,
      extentEnd: NOW,
      buckets: 60,
      unfiltered: false,
    })
    expect(screen.getAllByTestId(/^window-bar-/)).toHaveLength(60)
    expect(solid()).toEqual(Array.from({ length: 20 }, (_, i) => 40 + i))
  })

  test("a window in the past is centred", () => {
    const { last } = renderCharted()
    open()
    typeAndCommit("End gap", "3d")

    expect(last().extentStart).toBe(NOW - 5 * DAY_MS)
    expect(last().extentEnd).toBe(NOW - 2 * DAY_MS)
    expect(solid()).toEqual(Array.from({ length: 20 }, (_, i) => 20 + i))
  })

  test("a drag sets a Fixed window from the first bucket's start to the last's end", () => {
    renderCharted()
    open()

    // 72-minute buckets: 10 through 19 are 12h to 24h into the three days.
    // Each event its own render, as a person's are.
    fireEvent.pointerDown(bar(10))
    for (let i = 11; i <= 19; i++) fireEvent.pointerEnter(bar(i))
    fireEvent.pointerUp(bar(19))

    expect(trigger().textContent).toContain("Fixed")
    expect(value("Start")).toBe(
      formatLocalMinute(NOW - 3 * DAY_MS + 12 * HOUR_MS),
    )
    expect(value("End")).toBe(formatLocalMinute(NOW - 2 * DAY_MS))
  })

  test("a click sets the window to that one bucket", () => {
    renderCharted()
    open()

    fireEvent.pointerDown(bar(59))
    fireEvent.pointerUp(bar(59))

    expect(trigger().textContent).toContain("Fixed")
    expect(value("Duration")).toBe("1h 12m")
    expect(value("End gap")).toBe("0m")
  })

  test("hovering a bucket names its start and its count", () => {
    renderCharted()
    open()

    act(() => {
      fireEvent.pointerEnter(bar(7))
    })

    expect(screen.getByTestId("window-caption").textContent).toContain(
      "7 posts",
    )
  })

  test("pans back to the oldest stored Post, reading once it settles", async () => {
    const { last } = renderCharted(NOW - 30 * DAY_MS)
    open()
    // Three days of thirty, at the end.
    const scrollbar = screen.getByRole("scrollbar")
    expect(scrollbar.getAttribute("aria-valuenow")).toBe("90")
    act(() => {
      fireEvent.keyDown(scrollbar, { key: "ArrowLeft" })
    })
    expect(last().extentEnd).toBe(NOW)
    await act(() => new Promise((done) => setTimeout(done, 200)))
    expect(last().extentStart).toBe(NOW - 3.75 * DAY_MS)
    expect(last().extentEnd).toBe(NOW - 0.75 * DAY_MS)
  })

  test("a pick in a panned chart sets the window there and centres on it", async () => {
    const { last } = renderCharted(NOW - 30 * DAY_MS)
    open()
    act(() => {
      fireEvent.keyDown(screen.getByRole("scrollbar"), { key: "ArrowLeft" })
    })
    await act(() => new Promise((done) => setTimeout(done, 200)))
    fireEvent.pointerDown(bar(0))
    fireEvent.pointerUp(bar(0))
    expect(value("Start")).toBe(formatLocalMinute(NOW - 3.75 * DAY_MS))
    // Three times the 72-minute window, around it: the pan is dropped.
    expect(last().extentStart).toBe(NOW - 3.75 * DAY_MS - 72 * 60_000)
    expect(last().extentEnd).toBe(NOW - 3.75 * DAY_MS + 144 * 60_000)
    // And again from a Fixed window to another one.
    act(() => {
      fireEvent.keyDown(screen.getByRole("scrollbar"), { key: "ArrowLeft" })
    })
    await act(() => new Promise((done) => setTimeout(done, 200)))
    fireEvent.pointerDown(bar(59))
    fireEvent.pointerUp(bar(59))
    // The last 3.6-minute bucket of a view panned 54 minutes back.
    const start = NOW - 3.75 * DAY_MS + 86.4 * 60_000
    expect(last().extentStart).toBeLessThanOrEqual(start)
    expect(last().extentEnd).toBeGreaterThanOrEqual(start + 3.6 * 60_000)
  })

  test("a caption outside the current year names its year", () => {
    expect(stampText(Date.UTC(2024, 6, 9, 12), NOW)).toEndWith(", 2024")
    expect(stampText(Date.UTC(2026, 6, 9, 12), NOW)).not.toContain("2026")
  })

  test("the toggle changes what is requested", () => {
    const { last } = renderCharted()
    open()

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "All posts" }))
    })
    expect(last().unfiltered).toBe(true)

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Filtered" }))
    })
    expect(last().unfiltered).toBe(false)
  })

  test("zoom out triples the extent and zoom in returns, never past the default", () => {
    const { last } = renderCharted()
    open()
    const zoomIn = () =>
      screen.getByRole("button", { name: "Zoom in" }) as HTMLButtonElement

    expect(zoomIn().disabled).toBe(true)
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Zoom out" }))
    })
    expect(last().extentEnd - last().extentStart).toBe(9 * DAY_MS)
    expect(last().extentEnd).toBe(NOW)

    act(() => {
      fireEvent.click(zoomIn())
    })
    expect(last().extentEnd - last().extentStart).toBe(3 * DAY_MS)
  })

  test("the toggle and the zoom start over each time the editor opens", async () => {
    const { last } = renderCharted()
    open()
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Zoom out" }))
    })
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "All posts" }))
    })
    act(() => {
      fireEvent.keyDown(field("Duration"), { key: "Escape" })
    })
    await act(() => new Promise((done) => setTimeout(done, 0)))

    open()

    expect(last().extentEnd - last().extentStart).toBe(3 * DAY_MS)
    expect(last().unfiltered).toBe(false)
  })

  test("without a read the editor draws no chart", () => {
    renderControl()
    open()

    expect(screen.queryByTestId("window-bar-0")).toBeNull()
  })
})
