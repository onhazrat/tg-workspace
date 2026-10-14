/**
 * PROTOTYPE, throw away. The Summary tab after a Generate that failed before
 * its pending Summary was kept (a refused prompt, a failed sync, the network).
 * Nothing was saved, so there is nothing to paste into; the ways out are the
 * Action tab, or Generate again, here with a model of your choice (stubbed).
 */
import { SlidersHorizontal } from "lucide-react"
import { TgButton } from "@/components/ui/tg-button"
import { useSettings } from "@/contexts/SettingsContext"
import { useUI } from "@/contexts/UIContext"
import { clearFailures, START } from "./failure-store"
import { ErrorHistory, RetryControls, useRetry } from "./PendingFailureVariants"

export function StartFailurePanel() {
  const { setActiveTab } = useUI()
  const { selectedModel } = useSettings()
  const r = useRetry(START, selectedModel)
  if (!r.attempts) return null
  return (
    <div className="py-8 max-w-2xl">
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <h3 className="text-2xl font-bold tracking-tight">
          Summary not started
        </h3>
        <span className="bg-red-500/15 text-red-800 dark:text-red-200 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider">
          Nothing saved
        </span>
      </div>
      <ErrorHistory {...r} attempts={r.attempts} />
      <p className="text-sm text-app-ink/80 my-6">
        The prompt was never built, so no Summary was saved and no AI Key was
        charged.
      </p>
      <div className="flex flex-col md:flex-row md:items-center gap-2">
        <RetryControls {...r} label="Generate again" />
        <TgButton
          type="button"
          variant="secondary"
          size="lg"
          className="h-11 px-5"
          onClick={() => {
            clearFailures(START)
            setActiveTab("action")
          }}
        >
          <SlidersHorizontal size={14} />
          Change selection
        </TgButton>
      </div>
    </div>
  )
}
