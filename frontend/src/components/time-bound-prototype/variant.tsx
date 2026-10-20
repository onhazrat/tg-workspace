/**
 * PROTOTYPE (time-bound): app-wide variants on `?variant=`.
 *
 * "0" is main exactly; "1" edits every time filter (Directory Time bounds,
 * Cited by your channels, Channel moments, Logs) with the Posts tab's
 * Analysis window editor. Throwaway: fold the winner in, delete this.
 */
import { useNavigate, useSearch } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { createContext, useContext, useEffect } from "react"

export const VARIANTS = [
  { key: "0", name: "Current" },
  { key: "1", name: "One time editor" },
] as const

export type Variant = (typeof VARIANTS)[number]["key"]

export const VariantContext = createContext<Variant>("0")
export const useVariant = () => useContext(VariantContext)
export const useIsVariant1 = () => useVariant() === "1"

export function useVariantFromUrl(): Variant {
  const { variant } = useSearch({ strict: false }) as { variant?: string }
  return VARIANTS.find((v) => v.key === variant)?.key ?? "0"
}

export function PrototypeSwitcher() {
  const current = useVariantFromUrl()
  const navigate = useNavigate()
  const at = VARIANTS.findIndex((v) => v.key === current)
  const go = (d: number) => {
    const next = VARIANTS[(at + d + VARIANTS.length) % VARIANTS.length]
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
  const v = VARIANTS[at]
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
