/** PROTOTYPE, throw away. Floating variant switcher plus the stub's controls. */
import { getRouteApi } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useEffect } from "react"
import {
  FAKE_START_ERROR,
  recordStartFailure,
  setNextRetry,
  setSimulate,
  useFailureStore,
} from "./failure-store"

const workspaceRoute = getRouteApi("/_tg/workspace")

export const VARIANTS = {
  "0": "Current (reference)",
  A: "Banner on top",
  B: "Failure replaces waiting",
  C: "Two recovery paths",
} as const
export type Variant = keyof typeof VARIANTS
const KEYS = Object.keys(VARIANTS) as Variant[]

export function useVariant(): Variant {
  const { variant } = workspaceRoute.useSearch()
  return KEYS.includes(variant as Variant) ? (variant as Variant) : "0"
}

export function PrototypeSwitcher() {
  const variant = useVariant()
  const navigate = workspaceRoute.useNavigate()
  const store = useFailureStore()
  const go = (step: number) => {
    const next =
      KEYS[(KEYS.indexOf(variant) + step + KEYS.length) % KEYS.length]
    void navigate({ search: (s) => ({ ...s, variant: next }), replace: true })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest("input, textarea, [contenteditable]")) return
      if (e.key === "ArrowLeft") go(-1)
      if (e.key === "ArrowRight") go(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  if (!import.meta.env.DEV) return null
  return (
    <div className="fixed bottom-2 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-1 rounded-2xl bg-fuchsia-700/95 text-white px-3 py-1.5 shadow-2xl text-xs font-medium w-max max-w-[calc(100vw-32px)]">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => go(-1)} aria-label="Previous">
          <ChevronLeft size={16} />
        </button>
        <span className="text-center whitespace-nowrap">
          {variant} ({VARIANTS[variant]})
        </span>
        <button type="button" onClick={() => go(1)} aria-label="Next">
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="flex items-center gap-3 whitespace-nowrap opacity-90">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={store.simulate}
            onChange={(e) => setSimulate(e.target.checked)}
          />
          Simulate failure
        </label>
        <button
          type="button"
          className="underline"
          onClick={() => recordStartFailure(FAKE_START_ERROR)}
        >
          Fake start failure
        </button>
        <label className="flex items-center gap-1">
          Next retry
          <select
            className="bg-fuchsia-800 rounded px-1"
            value={store.nextRetry}
            onChange={(e) => setNextRetry(e.target.value as "fail" | "succeed")}
          >
            <option value="fail">fails</option>
            <option value="succeed">succeeds</option>
          </select>
        </label>
      </div>
    </div>
  )
}
