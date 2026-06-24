import { useEffect } from "react"

import { useCommandPaletteContext } from "@/components/CommandPaletteProvider"

export function useCommandPalette() {
  const { open, setOpen, toggle } = useCommandPaletteContext()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isPaletteShortcut =
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "p"
      if (!isPaletteShortcut) return
      event.preventDefault()
      toggle()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [toggle])

  return { open, setOpen, toggle }
}
