/**
 * PROTOTYPE, throw away. The Summary tab after a Generate that failed before
 * its pending Summary was kept (a refused prompt, a failed sync, the network).
 * Nothing was saved, so there is nothing to paste into; the ways out are the
 * Action tab, or Generate again, here with a model of your choice (stubbed).
 * Laid out like the finished report: header, error, then a card.
 */
import { RotateCcw, SlidersHorizontal } from "lucide-react"
import { TgButton } from "@/components/ui/tg-button"
import { useSettings } from "@/contexts/SettingsContext"
import { useUI } from "@/contexts/UIContext"
import { clearFailures, START } from "./failure-store"
import {
  Card,
  ErrorHistory,
  RetryControls,
  useRetry,
} from "./PendingFailureVariants"

export function StartFailurePanel() {
  const { setActiveTab } = useUI()
  const { selectedModel } = useSettings()
  const r = useRetry(START, selectedModel)
  if (!r.attempts) return null
  // The limit is the same for every model, so a retry cannot be the way out.
  const overLimit = /token limit|a single prompt/.test(
    r.attempts.at(-1)?.error ?? "",
  )
  return (
    <>
      <header className="mb-6 border-b border-app-ink/10 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xl font-bold tracking-tight">Analysis Report</h3>
          <span className="bg-red-500/15 text-red-800 dark:text-red-200 px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider">
            {r.retrying ? "Retrying" : "Not started"}
          </span>
        </div>
        <p className="mt-1 text-sm text-app-ink/80">
          The prompt was never built, so no Summary was saved and no AI Key was
          charged.
        </p>
      </header>
      <div className="space-y-6">
        <ErrorHistory {...r} attempts={r.attempts} />
        <Card icon={<RotateCcw size={14} />} title="Try again">
          <div className="flex flex-col md:flex-row md:items-end gap-2">
            <RetryControls {...r} label="Generate again" primary={!overLimit} />
            <TgButton
              type="button"
              variant={overLimit ? "primary" : "secondary"}
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
          {overLimit && (
            <p className="mt-3 text-xs text-app-ink/60">
              The limit is the same for every model, so this selection will fail
              again. Narrow it on the Action tab.
            </p>
          )}
        </Card>
      </div>
    </>
  )
}
