/**
 * PROTOTYPE: floating variant switcher for throwaway UI prototypes on
 * `/workspace`. Writes `?variant=`; ← and → cycle when no field has focus.
 * Dev builds only. Delete with the prototype.
 */
import { getRouteApi, useRouter } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useEffect, useSyncExternalStore } from "react"

const workspaceRoute = getRouteApi("/_tg/workspace")

const noop = () => () => {}

export function usePrototypeVariant(keys: readonly string[]): string {
  // Read off the history rather than `useSearch`, which throws outside a
  // RouterProvider: unit tests render feed pieces with no router, and they
  // get the first variant.
  const router = useRouter({ warn: false }) as ReturnType<
    typeof useRouter
  > | null
  const read = () =>
    router
      ? new URLSearchParams(router.history.location.search).get("variant")
      : null
  const variant = useSyncExternalStore(
    router ? (cb) => router.history.subscribe(cb) : noop,
    read,
    read,
  )
  return variant && keys.includes(variant) ? variant : keys[0]
}

export function PrototypeSwitcher({
  variants,
}: {
  variants: readonly { key: string; name: string }[]
}) {
  const keys = variants.map((v) => v.key)
  const current = usePrototypeVariant(keys)
  const navigate = workspaceRoute.useNavigate()
  const index = keys.indexOf(current)

  const go = (step: number) => {
    const next = keys[(index + step + keys.length) % keys.length]
    navigate({ search: (prev) => ({ ...prev, variant: next }), replace: true })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return
      // An open overlay (the photo gallery) owns the arrow keys.
      if (document.querySelector('[role="dialog"]')) return
      if (e.key === "ArrowLeft") go(-1)
      if (e.key === "ArrowRight") go(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  if (!import.meta.env.DEV) return null
  const name = variants[index]?.name
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-1 rounded-full bg-black text-white px-2 py-1.5 shadow-2xl ring-2 ring-fuchsia-500 font-mono text-xs">
      <button
        type="button"
        aria-label="Previous variant"
        onClick={() => go(-1)}
        className="p-1 rounded-full hover:bg-white/20"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="px-2 whitespace-nowrap">
        {current} ({name})
      </span>
      <button
        type="button"
        aria-label="Next variant"
        onClick={() => go(1)}
        className="p-1 rounded-full hover:bg-white/20"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  )
}
