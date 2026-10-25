// PROTOTYPE: the one-Spread prototype's `?variant=`, read app-wide. Never merge.
// Variant 0 is `main`; 1 is one Spread for every bound and the Analysis
// window, and one Number bound editor (docs/one-spread-plan.md).
import { getRouteApi } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { createContext, type ReactNode, useContext, useEffect } from "react"

const VARIANTS = [
  { key: "0", name: "main" },
  { key: "1", name: "One Spread" },
]

/** Defaults to `0`, so anything outside the provider, and every test, is `main`. */
const SpreadVariant = createContext("0")

export const useSpreadVariant = () => useContext(SpreadVariant)

const route = getRouteApi("/_tg/")

export function SpreadVariantRoot({ children }: { children: ReactNode }) {
  const raw = route.useSearch().variant
  const variant = VARIANTS.some((v) => v.key === raw) ? (raw as string) : "0"
  const navigate = route.useNavigate()
  return (
    <SpreadVariant.Provider value={variant}>
      {children}
      <PrototypeSwitcher
        current={variant}
        onChange={(key) =>
          navigate({
            search: (s) => ({ ...s, variant: key === "0" ? undefined : key }),
            replace: true,
          })
        }
      />
    </SpreadVariant.Provider>
  )
}

/** Alt+← and Alt+→, since Keyboard mode owns the plain arrows. */
function PrototypeSwitcher({
  current,
  onChange,
}: {
  current: string
  onChange: (key: string) => void
}) {
  const index = Math.max(
    0,
    VARIANTS.findIndex((v) => v.key === current),
  )
  const step = (by: number) =>
    onChange(VARIANTS[(index + by + VARIANTS.length) % VARIANTS.length].key)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return
      if (e.key === "ArrowLeft") step(-1)
      if (e.key === "ArrowRight") step(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  if (!import.meta.env.DEV) return null
  const v = VARIANTS[index]
  return (
    <div className="fixed bottom-5 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full border-2 border-fuchsia-500 bg-black px-2 py-1 font-mono text-xs text-white shadow-2xl">
      <button
        type="button"
        aria-label="Previous variant"
        onClick={() => step(-1)}
        className="rounded-full p-1 hover:bg-white/20"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="min-w-44 text-center">
        <span className="text-fuchsia-400">PROTOTYPE</span> {v.key} ({v.name}) ·{" "}
        {index + 1}/{VARIANTS.length}
      </span>
      <button
        type="button"
        aria-label="Next variant"
        onClick={() => step(1)}
        className="rounded-full p-1 hover:bg-white/20"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  )
}
