/**
 * PROTOTYPE, throw away. Three ways the pending Summary panel can show a failed
 * generation with a Retry. Retry is stubbed (`failure-store.ts`).
 */
import {
  AlertTriangle,
  ClipboardPaste,
  Copy,
  Loader2,
  RotateCcw,
} from "lucide-react"
import { toast } from "sonner"
import { TgButton } from "@/components/ui/tg-button"
import { formatSummaryModelLabel } from "@/constants"
import type { Summary } from "@/types"
import { RelativeTime } from "../RelativeTime"
import {
  PendingSummaryPanel,
  SummaryCounts,
  SummaryMetaChips,
} from "../summary-view/SummaryParts"
import {
  type Failure,
  failureFor,
  stubRetry,
  useFailureStore,
} from "./failure-store"
import type { Variant } from "./PrototypeSwitcher"

type Props = {
  variant: Exclude<Variant, "0">
  summary: Summary
  promptText: string | undefined
  onPaste: () => void
}

export function PendingFailurePrototype(props: Props) {
  const store = useFailureStore()
  const failure = failureFor(store, props.summary.id)
  const retrying = !!store.retrying[props.summary.id]
  // No failure: the pending panel as it is today (a Copy Prompt item).
  if (!failure && !retrying) return <PendingSummaryPanel {...props} />
  const retry = async () => {
    const ok = await stubRetry(props.summary.id)
    if (ok)
      toast.success(
        "Stub: retry succeeded. The real build would stream the saved prompt into this Summary.",
      )
    else toast.error("Retry failed again.")
  }
  const shared = { ...props, failure, retrying, retry }
  if (props.variant === "A") return <VariantA {...shared} />
  if (props.variant === "B") return <VariantB {...shared} />
  return <VariantC {...shared} />
}

type VariantProps = Props & {
  failure: Failure | undefined
  retrying: boolean
  retry: () => void
}

function RetryButton({
  retrying,
  retry,
  variant = "primary",
}: {
  retrying: boolean
  retry: () => void
  variant?: "primary" | "secondary"
}) {
  return (
    <TgButton
      type="button"
      variant={variant}
      size="lg"
      onClick={retry}
      disabled={retrying}
      className="h-11 px-5"
    >
      {retrying ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <RotateCcw size={14} />
      )}
      {retrying ? "Retrying…" : "Retry"}
    </TgButton>
  )
}

function ErrorText({ failure }: { failure: Failure | undefined }) {
  if (!failure) return null
  return (
    <>
      <p className="text-sm font-mono break-words">{failure.error}</p>
      <p className="text-[11px] opacity-70 mt-1">
        Attempt {failure.attempts} failed{" "}
        <RelativeTime timestamp={failure.at} />
      </p>
    </>
  )
}

function PromptFold({ promptText }: { promptText: string | undefined }) {
  return (
    <details className="rounded-xl border border-app-ink/10 bg-app-muted/10 p-4 md:p-6 group">
      <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-widest text-app-ink/70 flex items-center justify-between">
        Saved prompt
        <TgButton
          type="button"
          variant="secondary"
          size="sm"
          disabled={!promptText}
          onClick={(e) => {
            e.preventDefault()
            if (!promptText) return
            void navigator.clipboard.writeText(promptText)
            toast.success("Prompt copied.")
          }}
        >
          <Copy size={12} />
          Copy
        </TgButton>
      </summary>
      <pre className="mt-3 text-xs font-mono whitespace-pre-wrap leading-relaxed text-app-ink/80 max-h-[480px] overflow-y-auto custom-scrollbar">
        {promptText ?? "Loading prompt…"}
      </pre>
    </details>
  )
}

function Counts({ summary }: { summary: Summary }) {
  return (
    <div className="mt-8 pt-6 border-t border-app-ink/10 flex flex-wrap gap-2">
      <SummaryCounts
        postsLabel={`${summary.postCount ?? 0} Posts`}
        summary={summary}
      />
    </div>
  )
}

/** A: today's panel untouched, with a red banner above it. */
function VariantA(p: VariantProps) {
  return (
    <>
      <div
        role="alert"
        className="mb-6 flex flex-col sm:flex-row sm:items-center gap-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-900 dark:text-red-100 p-4"
      >
        <AlertTriangle size={20} className="shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm mb-1">Generation failed</p>
          {p.retrying ? (
            <p className="text-sm">Retrying with the saved prompt…</p>
          ) : (
            <ErrorText failure={p.failure} />
          )}
        </div>
        <RetryButton retrying={p.retrying} retry={p.retry} />
      </div>
      <PendingSummaryPanel
        summary={p.summary}
        promptText={p.promptText}
        onPaste={p.onPaste}
      />
    </>
  )
}

/**
 * B: the item says it failed, not that it waits. Retry is the primary action,
 * Paste is the fallback, and the prompt folds away.
 */
function VariantB(p: VariantProps) {
  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 border-b border-app-ink/10 pb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <h3 className="text-2xl font-bold tracking-tight">
              {p.retrying ? "Retrying…" : "Generation failed"}
            </h3>
            <span className="bg-red-500/15 text-red-800 dark:text-red-200 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider">
              {p.retrying ? "Running" : "Failed"}
            </span>
          </div>
          <SummaryMetaChips
            timestamp={p.summary.timestamp}
            model={p.summary.model}
            language={p.summary.language}
          />
        </div>
        <div className="flex flex-col-reverse md:flex-row gap-2">
          <TgButton
            type="button"
            variant="secondary"
            size="lg"
            onClick={p.onPaste}
            disabled={p.retrying}
            className="h-11 px-5"
          >
            <ClipboardPaste size={14} />
            Paste response
          </TgButton>
          <RetryButton retrying={p.retrying} retry={p.retry} />
        </div>
      </div>

      <div className="mb-6 rounded-lg border-l-4 border-red-500 bg-red-500/5 px-4 py-3 text-red-900 dark:text-red-100">
        {p.retrying ? (
          <p className="text-sm">
            Sending the saved prompt to{" "}
            {formatSummaryModelLabel(p.summary.model)} again…
          </p>
        ) : (
          <ErrorText failure={p.failure} />
        )}
      </div>

      <p className="text-sm text-app-ink/80 mb-4">
        The prompt is saved. Retry sends it again, or run it in another AI tool
        and paste the answer.
      </p>
      <PromptFold promptText={p.promptText} />
      <Counts summary={p.summary} />
    </>
  )
}

/** C: the error, then the two ways out given equal room. */
function VariantC(p: VariantProps) {
  return (
    <>
      <div className="mb-6 border-b border-app-ink/10 pb-6">
        <h3 className="text-2xl font-bold tracking-tight mb-3">
          This summary did not finish
        </h3>
        <SummaryMetaChips
          timestamp={p.summary.timestamp}
          model={p.summary.model}
          language={p.summary.language}
        />
      </div>

      <div className="mb-6 flex gap-3 text-red-900 dark:text-red-100">
        <AlertTriangle size={18} className="shrink-0 mt-0.5" />
        <div className="min-w-0">
          {p.retrying ? (
            <p className="text-sm">Retrying…</p>
          ) : (
            <ErrorText failure={p.failure} />
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl border border-app-ink/10 p-5 flex flex-col gap-3">
          <h4 className="text-[11px] font-bold uppercase tracking-widest text-app-ink/70">
            Try again here
          </h4>
          <p className="text-sm text-app-ink/80 flex-1">
            Send the saved prompt to{" "}
            <b>{formatSummaryModelLabel(p.summary.model)}</b> again. The same
            window and posts, nothing re-collected.
          </p>
          <RetryButton retrying={p.retrying} retry={p.retry} />
        </div>
        <div className="rounded-xl border border-app-ink/10 p-5 flex flex-col gap-3">
          <h4 className="text-[11px] font-bold uppercase tracking-widest text-app-ink/70">
            Use another AI
          </h4>
          <p className="text-sm text-app-ink/80 flex-1">
            Copy the prompt into any AI tool, then paste its answer here.
          </p>
          <div className="flex flex-wrap gap-2">
            <TgButton
              type="button"
              variant="secondary"
              size="lg"
              className="h-11 px-5"
              disabled={!p.promptText}
              onClick={() => {
                if (!p.promptText) return
                void navigator.clipboard.writeText(p.promptText)
                toast.success("Prompt copied.")
              }}
            >
              <Copy size={14} />
              Copy prompt
            </TgButton>
            <TgButton
              type="button"
              variant="secondary"
              size="lg"
              className="h-11 px-5"
              onClick={p.onPaste}
              disabled={p.retrying}
            >
              <ClipboardPaste size={14} />
              Paste response
            </TgButton>
          </div>
        </div>
      </div>

      <PromptFold promptText={p.promptText} />
      <Counts summary={p.summary} />
    </>
  )
}
