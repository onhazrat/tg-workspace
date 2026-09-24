import {
  ClipboardPaste,
  Clock,
  Copy,
  Database,
  Loader2,
  Tag,
} from "lucide-react"
import { toast } from "sonner"
import { TgButton } from "@/components/ui/tg-button"
import { formatSummaryModelLabel } from "@/constants"
import { scopeChannels } from "@/lib/scope/artifact-scope"
import type { Summary } from "@/types"
import { RelativeTime } from "../RelativeTime"

const META_CHIP =
  "bg-app-muted/50 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider text-app-ink/70 flex items-center gap-1.5"
const COUNT_CHIP =
  "bg-app-muted/30 px-2 py-1 rounded-md text-[11px] font-mono uppercase tracking-widest text-app-ink/70"

/** When, with which model, and in which language a summary was written. */
export function SummaryMetaChips({
  timestamp,
  model,
  language,
}: {
  timestamp: number
  model: string | null | undefined
  language: string | undefined
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <span className={META_CHIP}>
        <Clock size={12} /> <RelativeTime timestamp={timestamp} />
      </span>
      <span className={META_CHIP}>
        <Database size={12} /> {formatSummaryModelLabel(model)}
      </span>
      <span className={META_CHIP}>
        <Tag size={12} /> {language}
      </span>
    </div>
  )
}

export function SummaryCounts({
  postsLabel,
  summary,
}: {
  postsLabel: string
  summary: Summary
}) {
  return (
    <>
      <span className={COUNT_CHIP}>{postsLabel}</span>
      <span className={COUNT_CHIP}>
        {scopeChannels(summary).length} Channels
      </span>
    </>
  )
}

/** A summary whose prompt went to an external AI and whose answer has not been pasted back. */
export function PendingSummaryPanel({
  summary,
  promptText,
  onPaste,
}: {
  summary: Summary
  promptText: string | undefined
  onPaste: () => void
}) {
  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 border-b border-app-ink/10 pb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <h3 className="text-2xl font-bold tracking-tight">
              Awaiting External Response
            </h3>
            <span className="bg-amber-500/15 text-amber-800 dark:text-amber-200 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider">
              Prompt copied
            </span>
          </div>
          <SummaryMetaChips
            timestamp={summary.timestamp}
            model={summary.model}
            language={summary.language}
          />
        </div>
        <TgButton
          type="button"
          variant="primary"
          size="lg"
          onClick={onPaste}
          className="h-11 px-5"
        >
          <ClipboardPaste size={14} />
          Paste AI Response
        </TgButton>
      </div>

      <p className="text-sm text-app-ink/80 mb-4">
        This summary is waiting for your external AI result. Run the copied
        prompt in your AI tool, then paste the response here to complete the
        pending history entry.
      </p>

      <div className="rounded-xl border border-app-ink/10 bg-app-muted/10 p-4 md:p-6">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-[11px] font-bold uppercase tracking-widest text-app-ink/70">
            Copied Prompt
          </h4>
          <TgButton
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              if (!promptText) return
              void navigator.clipboard.writeText(promptText)
              toast.success("Prompt copied again.")
            }}
            disabled={!promptText}
          >
            <Copy size={12} />
            Copy again
          </TgButton>
        </div>
        <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed text-app-ink/80 max-h-[480px] overflow-y-auto custom-scrollbar">
          {promptText ?? "Loading prompt…"}
        </pre>
      </div>

      <div className="mt-8 pt-6 border-t border-app-ink/10 flex flex-wrap gap-2">
        <SummaryCounts
          postsLabel={`${summary.postCount ?? 0} Posts`}
          summary={summary}
        />
      </div>
    </>
  )
}

export function GeneratingSkeleton() {
  return (
    <div className="h-full flex flex-col py-12 space-y-8 animate-pulse">
      <div className="flex items-center gap-4 mb-4">
        <div className="w-12 h-12 bg-app-muted/20 rounded-xl" />
        <div className="space-y-2">
          <div className="h-5 bg-app-muted/20 rounded-md w-48" />
          <div className="h-3 bg-app-muted/20 rounded-md w-32" />
        </div>
      </div>
      <div className="space-y-4">
        <div className="h-4 bg-app-muted/20 rounded-md w-full" />
        <div className="h-4 bg-app-muted/20 rounded-md w-full" />
        <div className="h-4 bg-app-muted/20 rounded-md w-5/6" />
      </div>
      <div className="space-y-4 pt-4">
        <div className="h-4 bg-app-muted/20 rounded-md w-full" />
        <div className="h-4 bg-app-muted/20 rounded-md w-4/5" />
      </div>
      <div className="flex justify-center pt-8">
        <div className="flex items-center gap-2 text-app-ink/60">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-xs font-bold uppercase tracking-widest">
            Generating Analysis...
          </span>
        </div>
      </div>
    </div>
  )
}
