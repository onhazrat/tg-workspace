/**
 * Keyboard mode (PTR-02): j and k move a ring through the cards, a letter
 * fires the matching action on the ringed card, and nothing fires with a
 * modifier held, in a text field, or while a dialog is open.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { FeedKeyboard } from "./FeedKeyboard"

const translated = { a: mock(), b: mock() }

function Feed({ on = true }: { on?: boolean }) {
  return (
    <>
      <input aria-label="search" />
      {(["a", "b"] as const).map((id) => (
        <article key={id} data-post-key={`ch_${id}`}>
          <button type="button" data-shortcut="t" onClick={translated[id]}>
            Translate {id}
          </button>
        </article>
      ))}
      <FeedKeyboard on={on} />
    </>
  )
}

const ringed = () =>
  Array.from(document.querySelectorAll("[data-kbd-selected]")).map((el) =>
    el.getAttribute("data-post-key"),
  )
const press = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init })

beforeEach(() => {
  translated.a.mockClear()
  translated.b.mockClear()
})
afterEach(cleanup)

describe("FeedKeyboard", () => {
  test("j and k move the ring, and a letter fires that card's action", () => {
    render(<Feed />)
    press("j")
    expect(ringed()).toEqual(["ch_a"])
    press("j")
    press("j")
    expect(ringed()).toEqual(["ch_b"])
    press("t")
    expect(translated.b).toHaveBeenCalledTimes(1)
    press("k")
    expect(ringed()).toEqual(["ch_a"])
    press("t")
    expect(translated.a).toHaveBeenCalledTimes(1)
  })

  test("G rings the last card and gg the first", () => {
    render(<Feed />)
    press("G")
    expect(ringed()).toEqual(["ch_b"])
    press("g")
    expect(ringed()).toEqual(["ch_b"])
    press("g")
    expect(ringed()).toEqual(["ch_a"])
    expect(screen.getByText("first / last post")).toBeTruthy()
  })

  test("lists the keys while on, and leaves no ring behind when switched off", () => {
    const { rerender } = render(<Feed />)
    expect(screen.getByText("next / previous post")).toBeTruthy()
    press("j")
    rerender(<Feed on={false} />)
    expect(screen.queryByText("next / previous post")).toBeNull()
    expect(ringed()).toEqual([])
    press("j")
    expect(ringed()).toEqual([])
  })

  test("a modifier held fires nothing", () => {
    render(<Feed />)
    press("j")
    for (const mod of ["ctrlKey", "metaKey", "altKey"]) {
      press("t", { [mod]: true })
      press("j", { [mod]: true })
    }
    expect(translated.a).not.toHaveBeenCalled()
    expect(ringed()).toEqual(["ch_a"])
  })

  test("typing in a text field fires nothing", () => {
    render(<Feed />)
    press("j")
    screen.getByLabelText("search").focus()
    press("j")
    press("t")
    expect(ringed()).toEqual(["ch_a"])
    expect(translated.a).not.toHaveBeenCalled()
  })

  test("an open dialog fires nothing", () => {
    render(<Feed />)
    press("j")
    const dialog = document.createElement("div")
    dialog.setAttribute("role", "dialog")
    document.body.appendChild(dialog)
    try {
      press("j")
      press("t")
      expect(ringed()).toEqual(["ch_a"])
      expect(translated.a).not.toHaveBeenCalled()
    } finally {
      dialog.remove()
    }
  })
})
