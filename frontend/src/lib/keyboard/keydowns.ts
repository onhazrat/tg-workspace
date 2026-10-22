/**
 * For tests: the keydowns a US layout sends for typed keys, each capital or
 * shifted symbol preceded by its own Shift keydown, as a browser sends it.
 * Dispatching `G` alone hid three bugs in the prototype.
 */
const SHIFTED: Record<string, string> = {
  "?": "Slash",
  "*": "Digit8",
  "+": "Equal",
}
const PLAIN: Record<string, string> = {
  "/": "Slash",
  "\\": "Backslash",
  "-": "Minus",
  ",": "Comma",
  "[": "BracketLeft",
  "]": "BracketRight",
}

export interface Keydown {
  key: string
  code: string
  shiftKey?: boolean
}

export function keydowns(...typed: string[]): Keydown[] {
  return typed.flatMap((k): Keydown[] => {
    if (k.length > 1) return [{ key: k, code: k }]
    if (/^[0-9]$/.test(k)) return [{ key: k, code: `Digit${k}` }]
    const shifted = SHIFTED[k] ?? (/^[A-Z]$/.test(k) ? `Key${k}` : undefined)
    if (shifted)
      return [
        { key: "Shift", code: "ShiftLeft", shiftKey: true },
        { key: k, code: shifted, shiftKey: true },
      ]
    return [{ key: k, code: PLAIN[k] ?? `Key${k.toUpperCase()}` }]
  })
}
