import { useEffect, useState } from "react"

/**
 * Whether a chart is full screen, and the switch. Escape leaves it, before
 * the keyboard mode or an enclosing popover sees the key. Each change fires a
 * window resize, as charts that size themselves listen for one (Plotly does)
 * and the window itself does not resize.
 */
export function useFullScreen() {
  const [full, setFull] = useState(false)
  useEffect(() => {
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")))
    if (!full) return
    const leave = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.stopPropagation()
      setFull(false)
    }
    window.addEventListener("keydown", leave, true)
    return () => window.removeEventListener("keydown", leave, true)
  }, [full])
  return [full, setFull] as const
}
