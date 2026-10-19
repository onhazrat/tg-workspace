/**
 * PROTOTYPE, throw away. Floating bar that flips `?variant=` (← → too, except
 * while typing) and `?as=member` to preview the page as a plain account.
 * Hidden outside dev builds.
 */
import { getRouteApi } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useEffect } from "react"

const workspaceRoute = getRouteApi("/_tg/")

export function PrototypeSwitcher({
  variants,
}: {
  variants: { key: string; name: string }[]
}) {
  const { variant = variants[0].key, as } = workspaceRoute.useSearch()
  const navigate = workspaceRoute.useNavigate()
  const index = Math.max(
    0,
    variants.findIndex((v) => v.key === variant),
  )
  const go = (step: number) => {
    const next = variants[(index + step + variants.length) % variants.length]
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
  }, [index])
  if (!import.meta.env.DEV) return null
  const current = variants[index]
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-fuchsia-600 px-2 py-1 text-xs font-bold text-white shadow-xl">
      <button
        type="button"
        aria-label="Previous variant"
        onClick={() => go(-1)}
        className="rounded-full p-1 hover:bg-white/20"
      >
        <ChevronLeft size={14} />
      </button>
      <span className="min-w-40 text-center">
        {current.key} ({current.name})
      </span>
      <button
        type="button"
        aria-label="Next variant"
        onClick={() => go(1)}
        className="rounded-full p-1 hover:bg-white/20"
      >
        <ChevronRight size={14} />
      </button>
      <label className="ml-2 flex items-center gap-1 border-l border-white/30 pl-3 pr-1 font-normal">
        <input
          type="checkbox"
          checked={as === "member"}
          onChange={(e) =>
            navigate({
              search: (prev) => ({
                ...prev,
                as: e.target.checked ? "member" : undefined,
              }),
              replace: true,
            })
          }
        />
        as member
      </label>
    </div>
  )
}
