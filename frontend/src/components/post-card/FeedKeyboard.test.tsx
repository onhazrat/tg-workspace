/**
 * The Posts feed's adapter on keyboard mode's engine (PTR-02, ADR-034): j / k,
 * counts and gg / G move the Highlight, a key presses the highlighted card's
 * own control, Esc drops the Highlight, - and + switch the Compact grid, m
 * opens a Post's text and M every Post's, c in a spotlight goes back, and
 * each move is announced. Keys are typed as a browser sends them, Shift first.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { KeyboardMode } from "@/components/keyboard/KeyboardMode"
import { keydowns } from "@/lib/keyboard/keydowns"
import {
  announcement,
  lastHighlight,
  setKeyboardMode,
} from "@/lib/keyboard/mode"
import { usePostKeys } from "./FeedKeyboard"
import { PostCardBody } from "./PostCardBody"

const KEYS = ["ch_1", "ch_2", "ch_3"]
const LONG = "A long post.\n".repeat(20)

const OPS = {
  go: () => {},
  step: () => {},
  goToNth: () => {},
  close: () => {},
  reopen: () => {},
}

let translated: string[] = []

function Feed({
  spotlit = false,
  onBack = () => {},
}: {
  spotlit?: boolean
  onBack?: () => void
}) {
  const [compact, setCompact] = useState(false)
  const highlight = usePostKeys({
    keys: KEYS,
    onCompact: setCompact,
    spotlit,
    onSpotlightBack: onBack,
  })
  return (
    <>
      <KeyboardMode ops={OPS} />
      <output data-testid="compact">{String(compact)}</output>
      <input aria-label="Keyword search" />
      {KEYS.map((key) => (
        <article
          key={key}
          data-post-key={key}
          data-kbd-selected={highlight === key || undefined}
        >
          <button
            type="button"
            data-shortcut="l"
            onClick={() => translated.push(key)}
          >
            Translate
          </button>
          <PostCardBody text={LONG} linkSpans={null} postSearch="" />
        </article>
      ))}
    </>
  )
}

const ringed = () =>
  Array.from(document.querySelectorAll("[data-kbd-selected]")).map((el) =>
    el.getAttribute("data-post-key"),
  )
const type = (...keys: string[]) => {
  for (const init of keydowns(...keys))
    fireEvent.keyDown(document.activeElement ?? document.body, init)
}
const expanded = () =>
  screen
    .getAllByRole("button", { name: /Show More|Collapse/ })
    .map((b) => b.getAttribute("aria-expanded"))

beforeEach(() => {
  translated = []
  lastHighlight.clear()
  announcement.set("")
  setKeyboardMode(true)
})
afterEach(() => {
  cleanup()
  setKeyboardMode(false)
})

describe("the Posts feed's keyboard mode", () => {
  test("j and k move the Highlight, a count moves that far, G and gg jump", () => {
    render(<Feed />)
    type("j")
    expect(ringed()).toEqual(["ch_1"])
    type("2", "j")
    expect(ringed()).toEqual(["ch_3"])
    type("k")
    expect(ringed()).toEqual(["ch_2"])
    type("g", "g")
    expect(ringed()).toEqual(["ch_1"])
    type("G")
    expect(ringed()).toEqual(["ch_3"])
    type("2", "G")
    expect(ringed()).toEqual(["ch_2"])
  })

  test("each move is announced with the Post's Channel and its place", () => {
    render(<Feed />)
    type("j", "j")
    expect(screen.getByTestId("keyboard-announcer").textContent).toBe(
      "@ch, 2 of 3",
    )
  })

  test("l presses the highlighted card's translate, and Esc drops the Highlight", () => {
    render(<Feed />)
    type("j", "j", "l")
    expect(translated).toEqual(["ch_2"])
    type("Escape")
    expect(ringed()).toEqual([])
    type("l")
    expect(translated).toEqual(["ch_2"])
  })

  test("Esc with a Highlight is taken, so the spotlight's own Esc waits for the next one", () => {
    render(<Feed />)
    type("j")
    const esc = new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      document.body.dispatchEvent(esc)
    })
    expect(esc.defaultPrevented).toBe(true)
    const again = new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      document.body.dispatchEvent(again)
    })
    expect(again.defaultPrevented).toBe(false)
  })

  test("- and + switch the Compact grid on and off", () => {
    render(<Feed />)
    type("-")
    expect(screen.getByTestId("compact").textContent).toBe("true")
    type("+")
    expect(screen.getByTestId("compact").textContent).toBe("false")
  })

  test("m opens and closes the highlighted Post's text, M every Post's", () => {
    render(<Feed />)
    type("j", "j", "m")
    expect(expanded()).toEqual(["false", "true", "false"])
    type("M")
    expect(expanded()).toEqual(["true", "true", "true"])
    type("M")
    expect(expanded()).toEqual(["false", "false", "false"])
    type("m")
    expect(expanded()).toEqual(["false", "true", "false"])
  })

  test("c in a spotlight goes back; outside one it is the card's own control", () => {
    const onBack = mock()
    const view = render(<Feed onBack={onBack} />)
    type("c")
    expect(onBack).not.toHaveBeenCalled()
    view.rerender(<Feed spotlit onBack={onBack} />)
    type("c")
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  test("off, no Highlight shows and no key fires", () => {
    render(<Feed />)
    type("j")
    act(() => setKeyboardMode(false))
    expect(ringed()).toEqual([])
    type("l", "-")
    expect(translated).toEqual([])
    expect(screen.getByTestId("compact").textContent).toBe("false")
  })
})
