/**
 * The key interpreter (ADR-034): one table of real keydown sequences and the
 * commands each yields. A capital is always preceded by its own Shift keydown,
 * as a browser sends it; dispatching `G` alone hid three bugs in the prototype.
 */
import { describe, expect, test } from "bun:test"
import {
  type Command,
  IDLE,
  type Input,
  interpret,
  type KeyContext,
} from "./interpreter"

const SHIFTED: Record<string, string> = {
  "?": "Slash",
  "*": "Digit8",
  "+": "Equal",
}

/** A key as a US layout sends it: its code, and a Shift keydown before a capital. */
function keys(...typed: string[]): Input[] {
  return typed.flatMap((k): Input[] => {
    if (k === "Escape" || k === "Enter") return [{ key: k, code: k }]
    if (/^[0-9]$/.test(k)) return [{ key: k, code: `Digit${k}` }]
    const shiftedCode =
      SHIFTED[k] ?? (/^[A-Z]$/.test(k) ? `Key${k}` : undefined)
    const shift: Input = { key: "Shift", code: "ShiftLeft", shiftKey: true }
    if (shiftedCode)
      return [shift, { key: k, code: shiftedCode, shiftKey: true }]
    const code =
      { "/": "Slash", "\\": "Backslash", "-": "Minus", ",": "Comma" }[k] ??
      `Key${k.toUpperCase()}`
    return [{ key: k, code }]
  })
}

const ON_LIST: KeyContext = { on: true, list: true }

function run(inputs: (Input | "click")[], ctx: KeyContext = ON_LIST) {
  let state = IDLE
  const out: Command[] = []
  for (const input of inputs) {
    const step = interpret(state, input, ctx)
    state = step.state
    if (step.command) out.push(step.command)
  }
  return out
}

const ROWS: [string, (Input | "click")[], Command[], KeyContext?][] = [
  ["j moves down one", keys("j"), [{ type: "move", by: 1 }]],
  ["5j moves down five", keys("5", "j"), [{ type: "move", by: 5 }]],
  ["7k moves up seven", keys("7", "k"), [{ type: "move", by: -7 }]],
  ["gg goes to the first", keys("g", "g"), [{ type: "goto", nth: 1 }]],
  ["5gg goes to the fifth", keys("5", "g", "g"), [{ type: "goto", nth: 5 }]],
  ["G goes to the last", keys("G"), [{ type: "goto", nth: "last" }]],
  ["23G goes to the 23rd", keys("2", "3", "G"), [{ type: "goto", nth: 23 }]],
  [
    "10j keeps the 0 of a count",
    keys("1", "0", "j"),
    [{ type: "move", by: 10 }],
  ],
  ["4x drops the count", keys("4", "x"), [{ type: "act", key: "x" }]],
  [
    "4x then j moves one",
    keys("4", "x", "j"),
    [
      { type: "act", key: "x" },
      { type: "move", by: 1 },
    ],
  ],
  ["M is the capital", keys("M"), [{ type: "act", key: "M" }]],
  [
    "- and + resize",
    keys("-", "+"),
    [
      { type: "act", key: "-" },
      { type: "act", key: "+" },
    ],
  ],
  ["Enter opens", keys("Enter"), [{ type: "open" }]],
  ["Esc drops the Highlight", keys("Escape"), [{ type: "drop" }]],
  ["gt is the next tab", keys("g", "t"), [{ type: "strip", by: 1 }]],
  ["gT is the previous tab", keys("g", "T"), [{ type: "strip", by: -1 }]],
  ["3gt is the third tab", keys("3", "g", "t"), [{ type: "stripAt", nth: 3 }]],
  ["g3t is the third tab", keys("g", "3", "t"), [{ type: "stripAt", nth: 3 }]],
  ["5gT is five back", keys("5", "g", "T"), [{ type: "strip", by: -5 }]],
  ["g5T is five back", keys("g", "5", "T"), [{ type: "strip", by: -5 }]],
  ["gx closes the tab", keys("g", "x"), [{ type: "closeTab" }]],
  ["gX reopens the last closed", keys("g", "X"), [{ type: "reopenTab" }]],
  [
    "g then a letter goes to a tab",
    keys("g", "d"),
    [{ type: "tab", kind: "directory" }],
  ],
  [
    "g then a comma goes to Settings",
    keys("g", ","),
    [{ type: "tab", kind: "settings" }],
  ],
  [
    "g then ? cancels the g and steps help",
    keys("g", "?", "j"),
    [{ type: "help" }, { type: "move", by: 1 }],
  ],
  [
    "5 then ? cancels the count and steps help",
    keys("5", "?", "j"),
    [{ type: "help" }, { type: "move", by: 1 }],
  ],
  [
    "g then Esc cancels, and nothing fires",
    keys("g", "Escape", "t"),
    [{ type: "act", key: "t" }],
  ],
  [
    "5 then Esc cancels the count",
    keys("5", "Escape", "j"),
    [{ type: "move", by: 1 }],
  ],
  ["g then a click cancels", [...keys("g"), "click", ...keys("g")], []],
  [
    "a count then a click is dropped",
    [...keys("5"), "click", ...keys("j")],
    [{ type: "move", by: 1 }],
  ],
  [
    "g then a key it does not answer cancels it",
    keys("g", "q", "j"),
    [{ type: "move", by: 1 }],
  ],
  [
    "gg on a tab without a list does nothing",
    keys("g", "g"),
    [],
    {
      on: true,
      list: false,
    },
  ],
  [
    "g then a letter works without a list",
    keys("g", "p"),
    [{ type: "tab", kind: "posts" }],
    { on: true, list: false },
  ],
  [
    "j without a list does nothing",
    keys("j", "x", "Escape"),
    [],
    {
      on: true,
      list: false,
    },
  ],
  ["/ searches", keys("/"), [{ type: "search" }]],
  ["\\ switches keyboard mode", keys("\\"), [{ type: "mode" }]],
  [
    "off, only \\ and ? are read",
    keys("j", "g", "g", "\\", "?"),
    [{ type: "mode" }, { type: "help" }],
    { on: false, list: true },
  ],
  [
    "a Persian layout reads by position",
    [
      { key: "ت", code: "KeyJ" },
      { key: "۵", code: "Digit5" },
      { key: "ت", code: "KeyJ" },
      { key: "Shift", code: "ShiftLeft", shiftKey: true },
      { key: "گ", code: "KeyG", shiftKey: true },
      { key: "پ", code: "Backslash" },
    ],
    [
      { type: "move", by: 1 },
      { type: "move", by: 5 },
      { type: "goto", nth: "last" },
      { type: "mode" },
    ],
  ],
  [
    "a synthetic key with no code is read as typed",
    [{ key: "j", code: "" }],
    [{ type: "move", by: 1 }],
  ],
  [
    "Ctrl, Alt and Meta held alone change nothing",
    [
      ...keys("5", "g"),
      { key: "Control", code: "ControlLeft" },
      { key: "Alt", code: "AltLeft" },
      { key: "Meta", code: "MetaLeft" },
      ...keys("T"),
    ],
    [{ type: "strip", by: -5 }],
  ],
]

describe("the key interpreter", () => {
  for (const [name, inputs, expected, ctx] of ROWS)
    test(name, () => expect(run(inputs, ctx)).toEqual(expected))

  test("a waiting g and a count are visible in the state", () => {
    const [five] = keys("5")
    const [g] = keys("g")
    const after5 = interpret(IDLE, five, ON_LIST).state
    expect(after5).toEqual({ g: false, count: "5" })
    expect(interpret(after5, g, ON_LIST).state).toEqual({ g: true, count: "5" })
  })

  test("a key the interpreter takes for itself is swallowed", () => {
    const [g] = keys("g")
    expect(interpret(IDLE, g, ON_LIST).swallowed).toBe(true)
    const [shift] = keys("G")
    expect(interpret(IDLE, shift, ON_LIST).swallowed).toBe(false)
  })
})
