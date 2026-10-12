/**
 * PROTOTYPE (directory-follow-picks): Directory tab variants on `?variant=`.
 *
 * "0" is main exactly. "F" is everything kept from A to F: followed rows
 * tick like any other, keyboard mode with a panel Enter toggles and that
 * follows the highlight, a collapsed "Why it's here", a phone layout (a
 * controls sheet, card rows, a bottom-sheet panel, a one-line bulk bar),
 * named pick sets, and a search placeholder that names what it searches.
 * Throwaway: fold the winner in, delete this.
 */
import { useNavigate, useSearch } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { createContext, useContext, useEffect } from "react"

export const DIRECTORY_VARIANTS = [
  { key: "0", name: "Current" },
  { key: "F", name: "Follow picks, keyboard, phone layout, pick sets" },
] as const

export type DirectoryVariant = (typeof DIRECTORY_VARIANTS)[number]["key"]

export const DirectoryVariantContext = createContext<DirectoryVariant>("0")
/** Every change this prototype makes is F's; "0" stays main. */
export const useIsF = () => useContext(DirectoryVariantContext) === "F"

export function useVariantFromUrl(): DirectoryVariant {
  const { variant } = useSearch({ strict: false }) as { variant?: string }
  return DIRECTORY_VARIANTS.find((v) => v.key === variant)?.key ?? "0"
}

export function PrototypeSwitcher() {
  const current = useVariantFromUrl()
  const navigate = useNavigate()
  const at = DIRECTORY_VARIANTS.findIndex((v) => v.key === current)
  const go = (d: number) => {
    const n = DIRECTORY_VARIANTS.length
    const next = DIRECTORY_VARIANTS[(at + d + n) % n]
    navigate({
      to: ".",
      search: ((prev: Record<string, unknown>) => ({
        ...prev,
        variant: next.key,
      })) as never,
      replace: true,
    })
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (
        el?.closest(
          "input, textarea, [contenteditable=''], [contenteditable='true']",
        )
      )
        return
      if (!e.altKey) return
      if (e.key === "ArrowLeft") go(-1)
      if (e.key === "ArrowRight") go(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })
  if (!import.meta.env.DEV) return null
  const v = DIRECTORY_VARIANTS[at]
  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full bg-black px-2 py-1.5 font-mono text-xs text-white shadow-2xl ring-2 ring-fuchsia-500">
      <button
        type="button"
        aria-label="Previous variant"
        onClick={() => go(-1)}
        className="rounded-full p-1 hover:bg-white/20"
      >
        <ChevronLeft size={16} />
      </button>
      <span title="Alt+← / Alt+→">
        {v.key} ({v.name})
      </span>
      <button
        type="button"
        aria-label="Next variant"
        onClick={() => go(1)}
        className="rounded-full p-1 hover:bg-white/20"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  )
}
