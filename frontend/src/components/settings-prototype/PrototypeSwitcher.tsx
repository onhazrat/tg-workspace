/**
 * PROTOTYPE (settings redesign), throwaway. Floating bar that cycles
 * `?variant=`; ← / → work too, except while typing. Dev builds only.
 */
import { getRouteApi } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight } from "lucide-react"
import type React from "react"
import { useEffect } from "react"

const workspaceRoute = getRouteApi("/_tg/workspace")

export const PrototypeSwitcher: React.FC<{
  variants: { key: string; name: string }[]
  current: string
}> = ({ variants, current }) => {
  const navigate = workspaceRoute.useNavigate()
  const i = Math.max(
    0,
    variants.findIndex((v) => v.key === current),
  )
  const go = (step: number) => {
    const next = variants[(i + step + variants.length) % variants.length]
    navigate({
      search: (prev) => ({ ...prev, variant: next.key }),
      replace: true,
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest("input, textarea, select, [contenteditable=true]")) return
      if (e.key === "ArrowLeft") go(-1)
      if (e.key === "ArrowRight") go(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  if (!import.meta.env.DEV) return null
  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full bg-fuchsia-600 px-2 py-1.5 text-white shadow-xl">
      <button
        type="button"
        aria-label="Previous variant"
        onClick={() => go(-1)}
        className="rounded-full p-1 hover:bg-white/20"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="min-w-56 text-center text-xs font-semibold">
        {variants[i].key} · {variants[i].name}
        <span className="ml-1 font-normal opacity-70">
          ({i + 1}/{variants.length})
        </span>
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
