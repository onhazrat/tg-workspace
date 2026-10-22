/**
 * The Directory's adapter on keyboard mode's engine (DFP-01, ADR-034): j / k,
 * counts and gg / G move the Highlight, ] / [ turn the page and land on the
 * new page's first row once its rows arrive, a key presses the highlighted
 * row's own control, Enter opens or closes the panel, which follows the
 * Highlight while open, Esc drops the Highlight and closes it, and each move
 * is announced. Keys are typed as a browser sends them, Shift first.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { KeyboardMode } from "@/components/keyboard/KeyboardMode"
import { keydowns } from "@/lib/keyboard/keydowns"
import {
  announcement,
  lastHighlight,
  setKeyboardMode,
} from "@/lib/keyboard/mode"
import { useDirectoryKeys } from "./DirectoryKeyboard"

const PAGES = [
  ["a", "b", "c"],
  ["d", "e"],
]

let pressed: string[] = []

const OPS = {
  go: () => {},
  step: () => {},
  goToNth: () => {},
  close: () => {},
  reopen: () => {},
}

/**
 * The tab as the adapter sees it. `shown` is the page whose rows have
 * arrived, so a test can turn the page and deliver its rows later.
 */
function Directory({ shown = 0 }: { shown?: number }) {
  const [open, setOpen] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [ticks, setTicks] = useState<Set<string>>(new Set())
  const handles = PAGES[shown]
  const ring = useDirectoryKeys({
    handles,
    open,
    onOpen: setOpen,
    page,
    lastPage: PAGES.length - 1,
    onPage: setPage,
  })
  return (
    <>
      <input aria-label="Search the Directory" />
      <output data-testid="page">{page}</output>
      <output data-testid="open">{open ?? ""}</output>
      {handles.map((h) => (
        <div
          key={h}
          data-directory-handle={h}
          data-kbd-selected={ring === h || undefined}
        >
          <input
            type="checkbox"
            aria-label={`Tick @${h}`}
            data-shortcut="x"
            checked={ticks.has(h)}
            onChange={() => {
              pressed.push(h)
              setTicks((prev) => {
                const next = new Set(prev)
                if (!next.delete(h)) next.add(h)
                return next
              })
            }}
          />
        </div>
      ))}
    </>
  )
}

const tab = (shown = 0) => (
  <>
    <KeyboardMode ops={OPS} />
    <Directory shown={shown} />
  </>
)

const ringed = () =>
  Array.from(document.querySelectorAll("[data-kbd-selected]")).map((el) =>
    el.getAttribute("data-directory-handle"),
  )
const ticked = () =>
  Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  )
    .filter((box) => box.checked)
    .map((box) => box.getAttribute("aria-label")?.slice("Tick @".length))
const opened = () => screen.getByTestId("open").textContent
const type = (...keys: string[]) => {
  for (const init of keydowns(...keys))
    fireEvent.keyDown(document.activeElement ?? document.body, init)
}

beforeEach(() => {
  pressed = []
  lastHighlight.clear()
  announcement.set("")
  setKeyboardMode(true)
})
afterEach(() => {
  cleanup()
  setKeyboardMode(false)
})

describe("the Directory's keyboard mode", () => {
  test("j and k move the Highlight, G and gg jump, and nothing moves past an end", () => {
    render(tab())
    type("j")
    expect(ringed()).toEqual(["a"])
    type("j")
    expect(ringed()).toEqual(["b"])
    type("G")
    expect(ringed()).toEqual(["c"])
    type("j")
    expect(ringed()).toEqual(["c"])
    type("g", "g")
    expect(ringed()).toEqual(["a"])
    type("k")
    expect(ringed()).toEqual(["a"])
  })

  test("a count moves that far, and 2G goes to the second row", () => {
    render(tab())
    type("2", "j")
    expect(ringed()).toEqual(["b"])
    type("9", "k")
    expect(ringed()).toEqual(["a"])
    type("2", "G")
    expect(ringed()).toEqual(["b"])
  })

  test("each move is announced with the row's name and place", () => {
    render(tab())
    type("j", "j")
    expect(screen.getByTestId("keyboard-announcer").textContent).toBe(
      "@b, 2 of 3",
    )
  })

  test("a key presses the highlighted row's own control, and a count before it is dropped", () => {
    render(tab())
    type("x")
    expect(pressed).toEqual([])
    type("j", "j", "4", "x")
    expect(pressed).toEqual(["b"])
  })

  test("J and K tick while moving after an x that ticked, and untick after one that unticked", () => {
    render(tab())
    type("j", "x", "J")
    expect(ticked()).toEqual(["a", "b"])
    expect(ringed()).toEqual(["b"])
    type("J")
    expect(ticked()).toEqual(["a", "b", "c"])
    type("x", "K")
    expect(ticked()).toEqual(["a"])
    expect(ringed()).toEqual(["b"])
    type("K")
    expect(ticked()).toEqual([])
    expect(screen.getByTestId("keyboard-announcer").textContent).toBe(
      "@a, 1 of 3",
    )
  })

  test("J with no x yet ticks, and 3J moves one", () => {
    render(tab())
    type("j", "3", "J")
    expect(ticked()).toEqual(["a", "b"])
    expect(ringed()).toEqual(["b"])
  })

  test("Enter opens the panel, which follows every move until Enter closes it", () => {
    render(tab())
    type("j")
    expect(opened()).toBe("")
    type("Enter")
    expect(opened()).toBe("a")
    type("j")
    expect(opened()).toBe("b")
    type("G")
    expect(opened()).toBe("c")
    type("Enter")
    expect(opened()).toBe("")
    type("k")
    expect(ringed()).toEqual(["b"])
    expect(opened()).toBe("")
  })

  test("] turns the page and lands on its first row once the rows arrive, the panel too", () => {
    const view = render(tab())
    type("j", "Enter", "[")
    expect(screen.getByTestId("page").textContent).toBe("0")
    type("]")
    expect(screen.getByTestId("page").textContent).toBe("1")
    // The old page is still shown until the new one's rows arrive.
    expect(ringed()).toEqual(["a"])
    view.rerender(tab(1))
    expect(ringed()).toEqual(["d"])
    expect(opened()).toBe("d")
    type("]")
    expect(screen.getByTestId("page").textContent).toBe("1")
    type("[")
    expect(screen.getByTestId("page").textContent).toBe("0")
  })

  test("Esc drops the Highlight and closes the panel", () => {
    render(tab())
    type("j", "Enter", "Escape")
    expect(ringed()).toEqual([])
    expect(opened()).toBe("")
    type("x")
    expect(pressed).toEqual([])
  })

  test("an Esc a dialog already took leaves the Highlight and the panel (KM-01)", () => {
    render(tab())
    type("j", "Enter")
    // The photo viewer closes on Escape and marks it taken; in a browser the
    // dialog is gone before the page's own listener hears the key.
    const taken = new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
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
    render(tab())
    type("j")
    screen.getByLabelText("Search the Directory").focus()
    type("j", "Enter")
    expect(ringed()).toEqual(["a"])
    expect(opened()).toBe("")
    ;(document.activeElement as HTMLElement).blur()
    const dialog = document.createElement("div")
    dialog.setAttribute("role", "dialog")
    document.body.appendChild(dialog)
    try {
      type("j", "x", "]")
      expect(ringed()).toEqual(["a"])
      expect(pressed).toEqual([])
      expect(screen.getByTestId("page").textContent).toBe("0")
    } finally {
      dialog.remove()
    }
  })

  test("/ puts the cursor in the search box, and Esc there gives the keys back", () => {
    render(tab())
    type("/")
    const box = screen.getByLabelText("Search the Directory")
    expect(document.activeElement).toBe(box)
    type("Escape")
    expect(document.activeElement).not.toBe(box)
    type("j")
    expect(ringed()).toEqual(["a"])
  })

  test("off, no Highlight shows and no key moves it; on again, it is back", () => {
    render(tab())
    type("j")
    act(() => setKeyboardMode(false))
    expect(ringed()).toEqual([])
    type("j", "]")
    expect(ringed()).toEqual([])
    expect(screen.getByTestId("page").textContent).toBe("0")
    act(() => setKeyboardMode(true))
    expect(ringed()).toEqual(["a"])
  })

  test("the Highlight comes back when the tab is shown again", () => {
    const view = render(tab())
    type("j", "j")
    view.unmount()
    render(tab())
    expect(ringed()).toEqual(["b"])
  })
})
