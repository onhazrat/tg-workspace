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

import { AnalysisWindowControl } from "@/components/AnalysisWindowControl"
import { ScopeProvider } from "@/contexts/ScopeContext"

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

  test("Live boundaries are relative; Fixed boundaries are exact local instants", () => {
    renderControl()
    open()

    expect(value("Start")).toBe("1d")
    expect(field("Start").getAttribute("type")).toBe("text")

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Fixed" }))
    })

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
