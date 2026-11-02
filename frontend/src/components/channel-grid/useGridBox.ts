import type React from "react"
import { useLayoutEffect, useState } from "react"

/**
 * The channel grid's own width and its offset from the scroll container's top.
 *
 * The grid's width, not the window's: the workspace has a sidebar, so the two
 * disagree and the column count follows the container. The grid and its
 * loading skeleton both read it, so their columns cannot drift.
 */
export function useGridBox(ref: React.RefObject<HTMLDivElement | null>): {
  width: number
  top: number
} {
  const [box, setBox] = useState(() => ({
    width: typeof window === "undefined" ? 1280 : window.innerWidth,
    top: 0,
  }))

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    const apply = () =>
      setBox({ width: element.clientWidth, top: element.offsetTop })
    apply()

    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(apply)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return box
}
