import { type RefObject, useEffect, useState } from "react"

interface UsePaletteListSelectionOptions {
  isActive: boolean
  open: boolean
  firstNavigableId: string
  filterKey: string
  listRef: RefObject<HTMLDivElement | null>
}

export function usePaletteListSelection({
  isActive,
  open,
  firstNavigableId,
  filterKey,
  listRef,
}: UsePaletteListSelectionOptions) {
  const [selectedId, setSelectedId] = useState("")

  useEffect(() => {
    if (!isActive || !open) return
    setSelectedId(firstNavigableId)
    listRef.current?.scrollTo({ top: 0 })
  }, [filterKey, firstNavigableId, isActive, listRef, open])

  return { selectedId, setSelectedId }
}
