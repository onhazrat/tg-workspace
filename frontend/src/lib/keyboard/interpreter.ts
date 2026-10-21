/**
 * Keyboard mode's key interpreter (ADR-034): key events in, commands out. It
 * owns the waiting `g`, the count and the modifiers, and nothing else, so it
 * is pure and one table of key sequences pins every key's meaning
 * (`interpreter.test.ts`). The workspace's engine applies the commands.
 */
import type { TabType } from "@/constants"
import { GO } from "./key-list"

export type Command =
  /** j / k, by a count. */
  | { type: "move"; by: number }
  /** gg and G: the nth item, 1 first. */
  | { type: "goto"; nth: number | "last" }
  /** Any other key on a list: the list's action for it, if any. */
  | { type: "act"; key: string }
  | { type: "open" }
  | { type: "drop" }
  | { type: "tab"; kind: TabType }
  /** gt / gT, by a count. */
  | { type: "strip"; by: number }
  /** 3gt: the strip's nth tab, 1 first. */
  | { type: "stripAt"; nth: number }
  | { type: "closeTab" }
  | { type: "reopenTab" }
  | { type: "mode" }
  | { type: "help" }
  | { type: "search" }

/** What a `g` and a count wait for. */
export interface KeyState {
  g: boolean
  count: string
}
export const IDLE: KeyState = { g: false, count: "" }

/** The parts of a keydown the interpreter reads. */
export interface Input {
  key: string
  code: string
  shiftKey?: boolean
}

export interface KeyContext {
  /** Keyboard mode is on; off, only `\` and `?` are read. */
  on: boolean
  /** The tab has a list to move through. */
  list: boolean
}

export interface Step {
  state: KeyState
  command: Command | null
  /** The interpreter took the key itself (a digit, a `g`, a cancel). */
  swallowed: boolean
}

/** The Latin key at each position that is not a letter or a digit: plain, shifted. */
const PUNCTUATION: Record<string, [string, string]> = {
  Minus: ["-", "_"],
  // = and + share a key; + is the one keyboard mode names.
  Equal: ["+", "+"],
  BracketLeft: ["[", "{"],
  BracketRight: ["]", "}"],
  Backslash: ["\\", "|"],
  Semicolon: [";", ":"],
  Quote: ["'", '"'],
  Comma: [",", "<"],
  Period: [".", ">"],
  Slash: ["/", "?"],
  Backquote: ["`", "~"],
  NumpadAdd: ["+", "+"],
  NumpadSubtract: ["-", "-"],
  NumpadMultiply: ["*", "*"],
  NumpadDivide: ["/", "/"],
}
const DIGIT_SHIFTED = ")!@#$%^&*("

/**
 * The key as a US layout would type it at the same position, so keyboard mode
 * works whatever layout is active (a Persian one types ت for j). Esc, Enter and
 * the arrows are read as they are; a modifier on its own is null. A key with no
 * code (a synthetic event) is read as typed.
 */
export function readKey({ key, code, shiftKey = false }: Input): string | null {
  if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(key)) return null
  const letter = /^Key([A-Z])$/.exec(code)?.[1]
  if (letter) return shiftKey ? letter : letter.toLowerCase()
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code)?.[1]
  if (digit)
    return shiftKey && code.startsWith("Digit")
      ? DIGIT_SHIFTED[Number(digit)]
      : digit
  const punctuation = PUNCTUATION[code]
  if (punctuation) return punctuation[shiftKey ? 1 : 0]
  return key
}

const step = (
  state: KeyState,
  command: Command | null,
  swallowed = command !== null,
): Step => ({ state, command, swallowed })

/** What a key answers after a `g`, with the count typed before or after it. */
function afterG(key: string, n: number | null, list: boolean): Command | null {
  if (key === "g") return list ? { type: "goto", nth: n ?? 1 } : null
  if (key === "t")
    return n ? { type: "stripAt", nth: n } : { type: "strip", by: 1 }
  if (key === "T") return { type: "strip", by: -(n ?? 1) }
  if (key === "x") return { type: "closeTab" }
  if (key === "X") return { type: "reopenTab" }
  const kind = GO[key]
  return kind ? { type: "tab", kind } : null
}

/** A key with no `g` waiting: a move takes the count, anything else drops it. */
function plain(key: string, n: number | null, list: boolean): Command | null {
  if (key === "/") return { type: "search" }
  if (!list) return null
  if (key === "j") return { type: "move", by: n ?? 1 }
  if (key === "k") return { type: "move", by: -(n ?? 1) }
  if (key === "G") return { type: "goto", nth: n ?? "last" }
  if (key === "Enter") return { type: "open" }
  if (key === "Escape") return { type: "drop" }
  // Arrows, Tab and the rest of the named keys are not keyboard mode's.
  if (key.length > 1) return null
  return { type: "act", key }
}

export function interpret(
  state: KeyState,
  input: Input | "click",
  ctx: KeyContext,
): Step {
  if (input === "click") return step(IDLE, null, false)
  const key = readKey(input)
  // A modifier's own keydown (the Shift of gT or 23G) keeps what waits.
  if (key === null) return step(state, null, false)
  if (key === "\\") return step(IDLE, { type: "mode" })
  if (key === "?") return step(IDLE, { type: "help" })
  if (!ctx.on) return step(IDLE, null, false)
  const waiting = state.g || state.count !== ""
  if (key === "Escape" && waiting) return step(IDLE, null, true)
  if (/^[0-9]$/.test(key) && (key !== "0" || state.count))
    return step({ ...state, count: state.count + key }, null, true)
  const n = state.count ? Number(state.count) : null
  if (state.g) return step(IDLE, afterG(key, n, ctx.list), true)
  if (key === "g") return step({ g: true, count: state.count }, null, true)
  // Whether it did anything is the engine's to say: an Esc with nothing to
  // drop belongs to whatever else listens (the spotlight's way back).
  return step(IDLE, plain(key, n, ctx.list), false)
}
