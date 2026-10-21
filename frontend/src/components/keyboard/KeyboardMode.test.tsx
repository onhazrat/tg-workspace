/**
 * Keyboard mode's engine at the workspace (ADR-034): `\` turns it on and off
 * from any tab, the full list open included; `g` then a letter and the strip
 * keys reach the tab strip from a tab without a list; `?` steps the help; a
 * click cancels a waiting `g`. Keys are typed as a browser sends them.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { keydowns } from "@/lib/keyboard/keydowns"
import {
  keyboardOn,
  pending,
  setAdhocHelp,
  setHelp,
  setKeyboardMode,
  useAdhocHelp,
  useHelp,
} from "@/lib/keyboard/mode"
import { KeyboardMode } from "./KeyboardMode"

let calls: string[] = []
const OPS = {
  go: (kind: string) => calls.push(`go ${kind}`),
  step: (by: number) => calls.push(`step ${by}`),
  goToNth: (nth: number) => calls.push(`nth ${nth}`),
  close: () => calls.push("close"),
  reopen: () => calls.push("reopen"),
}

function Help() {
  return (
    <output data-testid="help">
      {useHelp()} {String(useAdhocHelp())}
    </output>
  )
}

const type = (...keys: string[]) => {
  for (const init of keydowns(...keys))
    fireEvent.keyDown(document.activeElement ?? document.body, init)
}
const help = () => document.querySelector("[data-testid=help]")?.textContent

beforeEach(() => {
  calls = []
  setHelp("closed")
  setAdhocHelp(false)
  setKeyboardMode(true)
})
afterEach(() => {
  cleanup()
  setKeyboardMode(false)
})

describe("the workspace's keys", () => {
  test("\\ turns keyboard mode off and on, and an open full list does not stop it", () => {
    render(<KeyboardMode ops={OPS} />)
    type("\\")
    expect(keyboardOn()).toBe(false)
    const list = document.createElement("div")
    list.setAttribute("role", "dialog")
    list.setAttribute("data-shortcuts-list", "")
    document.body.append(list)
    try {
      type("\\")
      expect(keyboardOn()).toBe(true)
      // Over the full list nothing else fires.
      type("g", "p")
      expect(calls).toEqual([])
    } finally {
      list.remove()
    }
  })

  test("g then a letter goes to that tab, from a tab without a list", () => {
    render(<KeyboardMode ops={OPS} />)
    type("g", "p", "g", "c", "g", "d", "g", "v", "g", "a", "g", "s")
    type("g", "l", "g", "m", "g", "h", "g", "o", "g", ",")
    expect(calls).toEqual([
      "go posts",
      "go channels",
      "go directory",
      "go discover",
      "go action",
      "go summary",
      "go tag",
      "go chat",
      "go history",
      "go tools",
      "go settings",
    ])
  })

  test("gt and gT step the strip, with a count before or after the g; gx and gX close and reopen", () => {
    render(<KeyboardMode ops={OPS} />)
    type("g", "t", "g", "T", "3", "g", "t", "g", "3", "t")
    type("5", "g", "T", "g", "5", "T", "g", "x", "g", "X")
    expect(calls).toEqual([
      "step 1",
      "step -1",
      "nth 3",
      "nth 3",
      "step -5",
      "step -5",
      "close",
      "reopen",
    ])
  })

  test("gg with no list does nothing, and a click cancels a waiting g", () => {
    render(<KeyboardMode ops={OPS} />)
    type("g", "g", "p")
    expect(calls).toEqual([])
    type("g")
    expect(pending.get().g).toBe(true)
    fireEvent.pointerDown(document.body)
    expect(pending.get().g).toBe(false)
    type("t")
    expect(calls).toEqual([])
  })

  test("? steps closed, full (no corner without a list), closed; off, it opens the full list alone", () => {
    render(
      <>
        <KeyboardMode ops={OPS} />
        <Help />
      </>,
    )
    type("?")
    expect(help()).toBe("full false")
    type("?")
    expect(help()).toBe("closed false")
    act(() => setKeyboardMode(false))
    type("?")
    expect(help()).toBe("closed true")
    type("?")
    expect(help()).toBe("closed false")
  })

  test("off, no g key reaches the strip", () => {
    render(<KeyboardMode ops={OPS} />)
    act(() => setKeyboardMode(false))
    type("g", "t", "g", "p")
    expect(calls).toEqual([])
  })
})
