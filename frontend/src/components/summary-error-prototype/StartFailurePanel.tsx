/**
 * PROTOTYPE, throw away. The Summary tab after a Generate that failed before
 * its pending Summary was kept (a refused prompt, a failed sync, the network).
 * Nothing was saved, so there is nothing to paste into; the way out is the
 * Action tab, or Generate again for a transient error.
 */
import {
  AlertTriangle,
  Loader2,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { TgButton } from "@/components/ui/tg-button"
import { useUI } from "@/contexts/UIContext"
import { RelativeTime } from "../RelativeTime"
import { recordStartFailure } from "./failure-store"

export function StartFailurePanel({
  failure,
}: {
  failure: { error: string; at: number }
}) {
  const { setActiveTab } = useUI()
  const [retrying, setRetrying] = useState(false)
  // Stubbed like the pending Retry: the real one is Generate with the same selection.
  const retry = async () => {
    setRetrying(true)
    await new Promise((r) => setTimeout(r, 1500))
    setRetrying(false)
    recordStartFailure(failure.error)
    toast.error("Stub: failed again with the same selection.")
  }
  return (
    <div className="py-8 max-w-2xl">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h3 className="text-2xl font-bold tracking-tight">
          Summary not started
        </h3>
        <span className="bg-red-500/15 text-red-800 dark:text-red-200 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider">
          Nothing saved
        </span>
      </div>
      <div className="my-6 rounded-lg border-l-4 border-red-500 bg-red-500/5 px-4 py-3 text-red-900 dark:text-red-100 flex gap-3">
        <AlertTriangle size={18} className="shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-mono break-words">{failure.error}</p>
          <p className="text-[11px] opacity-70 mt-1">
            Failed <RelativeTime timestamp={failure.at} />
          </p>
        </div>
      </div>
      <p className="text-sm text-app-ink/80 mb-6">
        The prompt was never built, so no Summary was saved and no AI Key was
        charged.
      </p>
      <div className="flex flex-col-reverse sm:flex-row gap-2">
        <TgButton
          type="button"
          variant="secondary"
          size="lg"
          className="h-11 px-5"
          onClick={() => void retry()}
          disabled={retrying}
        >
          {retrying ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RotateCcw size={14} />
          )}
          {retrying ? "Generating…" : "Generate again"}
        </TgButton>
        <TgButton
          type="button"
          variant="primary"
          size="lg"
          className="h-11 px-5"
          onClick={() => {
            recordStartFailure(null)
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
