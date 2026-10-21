/**
 * Keyboard mode on the Directory (DFP-01), on the Posts feed's and Channels
 * grid's terms: j / k and gg / G move a highlight, ] / [ turn the page and
 * land on the new page's first row once its rows arrive, a letter presses the
 * highlighted row's own control, Enter opens or closes the panel, which
 * follows the highlight while open, and Esc drops the highlight and closes it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { DirectoryKeyHelp, useDirectoryKeyboard } from "./DirectoryKeyboard"

const PAGES = [
  ["a", "b", "c"],
  ["d", "e"],
]

let pressed: string[] = []

/**
 * The tab as the hook sees it. `shown` is the page whose rows have arrived,
 * so a test can turn the page and deliver its rows later.
 */
function Directory({ on = true, shown = 0 }: { on?: boolean; shown?: number }) {
  const [open, setOpen] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const handles = PAGES[shown]
  const ring = useDirectoryKeyboard({
    on,
    handles,
    open,
    onOpen: setOpen,
    page,
    lastPage: PAGES.length - 1,
    onPage: setPage,
  })
  return (
    <>
      <input aria-label="search" />
      <output data-testid="page">{page}</output>
      <output data-testid="open">{open ?? ""}</output>
      {handles.map((h) => (
        <div
          key={h}
          data-directory-handle={h}
          data-kbd-selected={ring === h || undefined}
        >
          <button
            type="button"
            data-shortcut="x"
            onClick={() => pressed.push(h)}
          >
            Tick {h}
          </button>
        </div>
      ))}
      <DirectoryKeyHelp on={on} />
    </>
  )
}

const ringed = () =>
  Array.from(document.querySelectorAll("[data-kbd-selected]")).map((el) =>
    el.getAttribute("data-directory-handle"),
  )
const opened = () => screen.getByTestId("open").textContent
const press = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init })

beforeEach(() => {
  pressed = []
})
afterEach(cleanup)

describe("the Directory's keyboard mode", () => {
  test("j and k move the highlight, G and gg jump, and nothing moves past an end", () => {
    render(<Directory />)
    press("j")
    expect(ringed()).toEqual(["a"])
    press("j")
    expect(ringed()).toEqual(["b"])
    press("G")
    expect(ringed()).toEqual(["c"])
    press("j")
    expect(ringed()).toEqual(["c"])
    press("g")
    press("g")
    expect(ringed()).toEqual(["a"])
    press("k")
    expect(ringed()).toEqual(["a"])
  })

  test("a letter presses the highlighted row's own control", () => {
    render(<Directory />)
    press("x")
    expect(pressed).toEqual([])
    press("j")
    press("j")
    press("x")
    expect(pressed).toEqual(["b"])
  })

  test("Enter opens the panel, which follows every move until Enter closes it", () => {
    render(<Directory />)
    press("j")
    expect(opened()).toBe("")
    press("Enter")
    expect(opened()).toBe("a")
    press("j")
    expect(opened()).toBe("b")
    press("G")
    expect(opened()).toBe("c")
    press("Enter")
    expect(opened()).toBe("")
    press("k")
    expect(ringed()).toEqual(["b"])
    expect(opened()).toBe("")
  })

  test("] turns the page and lands on its first row once the rows arrive, the panel too", () => {
    const view = render(<Directory />)
    press("j")
    press("Enter")
    press("[")
    expect(screen.getByTestId("page").textContent).toBe("0")
    press("]")
    expect(screen.getByTestId("page").textContent).toBe("1")
    // The old page is still shown until the new one's rows arrive.
    expect(ringed()).toEqual(["a"])
    view.rerender(<Directory shown={1} />)
    expect(ringed()).toEqual(["d"])
    expect(opened()).toBe("d")
    press("]")
    expect(screen.getByTestId("page").textContent).toBe("1")
    press("[")
    expect(screen.getByTestId("page").textContent).toBe("0")
  })

  test("Esc drops the highlight and closes the panel", () => {
    render(<Directory />)
    press("j")
    press("Enter")
    press("Escape")
    expect(ringed()).toEqual([])
    expect(opened()).toBe("")
    press("x")
    expect(pressed).toEqual([])
  })

  test("an Esc a dialog already took leaves the highlight and the panel (KM-01)", () => {
    render(<Directory />)
    press("j")
    press("Enter")
    // The photo viewer closes on Escape and marks it taken; in a browser the
    // dialog is gone before the page's own listener hears the key.
    const taken = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    })
    taken.preventDefault()
    act(() => {
      window.dispatchEvent(taken)
    })
    expect(ringed()).toEqual(["a"])
    expect(opened()).toBe("a")
  })

  test("typing in a field or an open dialog fires nothing", () => {
    render(<Directory />)
    press("j")
    screen.getByLabelText("search").focus()
    press("j")
    press("Enter")
    expect(ringed()).toEqual(["a"])
    expect(opened()).toBe("")
    ;(document.activeElement as HTMLElement).blur()
    const dialog = document.createElement("div")
    dialog.setAttribute("role", "dialog")
    document.body.appendChild(dialog)
    try {
      press("j")
      press("x")
      press("]")
      expect(ringed()).toEqual(["a"])
      expect(pressed).toEqual([])
      expect(screen.getByTestId("page").textContent).toBe("0")
    } finally {
      dialog.remove()
    }
  })

  test("lists the keys while on; off, no highlight and no keys", () => {
    const view = render(<Directory />)
    expect(screen.getByText("open or close the panel")).toBeTruthy()
    press("j")
    view.rerender(<Directory on={false} />)
    expect(screen.queryByText("open or close the panel")).toBeNull()
    expect(ringed()).toEqual([])
    press("j")
    press("]")
    expect(ringed()).toEqual([])
    expect(screen.getByTestId("page").textContent).toBe("0")
  })
})
