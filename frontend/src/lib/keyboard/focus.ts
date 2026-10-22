/** Inputs that take a click, not typing, so a key pressed on one is the page's. */
const CLICKED_INPUTS = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
])

/** Whether focus is in a field a key could be typing into. */
export function focusIsTyping(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  if (el instanceof HTMLInputElement) return !CLICKED_INPUTS.has(el.type)
  return (
    el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable
  )
}
