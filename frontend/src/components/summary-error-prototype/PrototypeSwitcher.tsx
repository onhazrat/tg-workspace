/** PROTOTYPE, throw away. Floating variant switcher plus the stub's controls. */

import { useQueryClient } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useEffect } from "react"
import { useSettings } from "@/contexts/SettingsContext"
import { useUI } from "@/contexts/UIContext"
import { useSelectedAiKeyId } from "@/hooks/useAiKeys"
import { postAttempt, stubAttempt } from "./attempts-api"
import {
  FAKE_START_ERROR,
  type NextOutcome,
  recordFailure,
  START,
  setNextRetry,
  setSimulate,
  useFailureStore,
} from "./failure-store"

const workspaceRoute = getRouteApi("/_tg/workspace")

export const VARIANTS = {
  "0": "Current (reference)",
  C: "Two recovery paths",
  D: "Stored attempts, drafts, auto-retry",
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
  const { selectedModel } = useSettings()
  const { currentSummaryId } = useUI()
  const keyId = useSelectedAiKeyId()
  const qc = useQueryClient()
  // Variant D: record a stubbed attempt (the outcome chosen below) as if a
  // Generate had just ended that way, so the stored history has a start.
  const logAttempt = async () => {
    if (!currentSummaryId) return
    await postAttempt(
      currentSummaryId,
      stubAttempt(store.nextRetry, selectedModel, keyId, false),
    )
    await qc.invalidateQueries({
      predicate: (q) => String(q.queryKey[0]).startsWith("proto-"),
    })
  }
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
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 opacity-90">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={store.simulate}
            onChange={(e) => setSimulate(e.target.checked)}
          />
          Simulate failure
        </label>
        {variant === "D" && (
          <button
            type="button"
            className="underline disabled:opacity-50"
            disabled={!currentSummaryId}
            onClick={() => void logAttempt()}
          >
            Log attempt
          </button>
        )}
        <button
          type="button"
          className="underline"
          onClick={() =>
            recordFailure(START, FAKE_START_ERROR, selectedModel, null)
          }
        >
          Fake start failure
        </button>
        <label className="flex items-center gap-1">
          Next retry
          <select
            className="bg-fuchsia-800 rounded px-1"
            value={store.nextRetry}
            onChange={(e) => setNextRetry(e.target.value as NextOutcome)}
          >
            <option value="quota">fails: quota</option>
            <option value="timeout">fails: overloaded</option>
            <option value="cut">stream cut</option>
            <option value="succeed">succeeds</option>
          </select>
        </label>
      </div>
    </div>
  )
}
