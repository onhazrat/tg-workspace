/**
 * PROTOTYPE, throw away. Three ways the pending Summary panel can show a failed
 * generation, its error history, and a Retry with a model of your choice.
 * Retry is stubbed (`failure-store.ts`).
 */
import {
  AlertTriangle,
  ClipboardPaste,
  Copy,
  Loader2,
  RotateCcw,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { ModelCombo } from "@/components/ai/ModelCombo"
import { TgButton } from "@/components/ui/tg-button"
import { tgFieldClassName } from "@/components/ui/tg-input"
import { formatSummaryModelLabel } from "@/constants"
import type { Summary } from "@/types"
import { RelativeTime } from "../RelativeTime"
import {
  PendingSummaryPanel,
  SummaryCounts,
  SummaryMetaChips,
} from "../summary-view/SummaryParts"
import {
  type Attempt,
  attemptsFor,
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

/** The retry state every surface shares: the history, the model, the stub. */
export function useRetry(id: string, initialModel: string) {
  const store = useFailureStore()
  const attempts = attemptsFor(store, id, initialModel)
  const retrying = !!store.retrying[id]
  // Starts at the model the last attempt used; local, so the account's
  // default stays put.
  const [model, setModel] = useState(attempts?.at(-1)?.model || initialModel)
  const retry = async () => {
    const ok = await stubRetry(id, model, attempts ?? [])
    if (ok)
      toast.success(
        `Stub: retry with ${model} succeeded. The real build would stream the saved prompt into this Summary.`,
      )
    else toast.error(`Retry with ${model} failed.`)
  }
  return { attempts, retrying, model, setModel, retry }
}

export function PendingFailurePrototype(props: Props) {
  const r = useRetry(props.summary.id, props.summary.model ?? "")
  // No failure: the pending panel as it is today (a Copy Prompt item).
  if (!r.attempts && !r.retrying) return <PendingSummaryPanel {...props} />
  const shared = { ...props, ...r, attempts: r.attempts ?? [] }
  if (props.variant === "A") return <VariantA {...shared} />
  if (props.variant === "B") return <VariantB {...shared} />
  return <VariantC {...shared} />
}

type VariantProps = Props & {
  attempts: Attempt[]
  retrying: boolean
  model: string
  setModel: (m: string) => void
  retry: () => void
}

export function RetryControls({
  model,
  setModel,
  retrying,
  retry,
  label = "Retry",
}: {
  model: string
  setModel: (m: string) => void
  retrying: boolean
  retry: () => void
  label?: string
}) {
  return (
    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
      <ModelCombo
        ariaLabel="Model for the retry"
        value={model}
        onChange={setModel}
        remember={false}
        className={`${tgFieldClassName} sm:w-60 h-11`}
      />
      <TgButton
        type="button"
        variant="primary"
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
        {retrying ? "Retrying…" : label}
      </TgButton>
    </div>
  )
}

/** The latest error up front, then every earlier one, newest first. */
export function ErrorHistory({
  attempts,
  retrying,
  model,
}: {
  attempts: Attempt[]
  retrying: boolean
  model: string
}) {
  const latest = attempts.at(-1)
  const earlier = attempts.slice(0, -1).reverse()
  return (
    <div className="space-y-3">
      {retrying && (
        <p className="text-sm flex items-center gap-2 text-app-ink/80">
          <Loader2 size={14} className="animate-spin" />
          Attempt {attempts.length + 1} with {formatSummaryModelLabel(model)}…
        </p>
      )}
      {latest && (
        <div className="rounded-lg border-l-4 border-red-500 bg-red-500/5 px-4 py-3 text-red-900 dark:text-red-100 flex gap-3">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-mono break-words">{latest.error}</p>
            <AttemptMeta n={attempts.length} attempt={latest} />
          </div>
        </div>
      )}
      {earlier.length > 0 && (
        <div className="rounded-lg border border-app-ink/10 px-4 py-3">
          <h4 className="text-[11px] font-bold uppercase tracking-widest text-app-ink/60 mb-2">
            Earlier attempts ({earlier.length})
          </h4>
          <ol className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar">
            {earlier.map((a, i) => (
              <li
                key={a.at}
                className="border-t border-app-ink/5 first:border-0 pt-2 first:pt-0"
              >
                <p className="text-xs font-mono break-words text-app-ink/70">
                  {a.error}
                </p>
                <AttemptMeta n={attempts.length - 1 - i} attempt={a} />
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

function AttemptMeta({ n, attempt }: { n: number; attempt: Attempt }) {
  return (
    <p className="text-[11px] opacity-70 mt-1">
      Attempt {n} · {formatSummaryModelLabel(attempt.model)} ·{" "}
      <RelativeTime timestamp={attempt.at} />
    </p>
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

function PasteButton(p: VariantProps) {
  return (
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
  )
}

/** A: today's panel untouched, with a failure block above it. */
function VariantA(p: VariantProps) {
  return (
    <>
      <div
        role="alert"
        className="mb-6 rounded-xl border border-red-500/30 bg-red-500/5 p-4 space-y-4"
      >
        <p className="font-bold text-sm text-red-900 dark:text-red-100">
          Generation failed
        </p>
        <ErrorHistory {...p} />
        <RetryControls {...p} />
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
 * B: the item says it failed, not that it waits. Retry and its model lead,
 * Paste is the fallback, and the prompt folds away.
 */
function VariantB(p: VariantProps) {
  return (
    <>
      <div className="mb-6 border-b border-app-ink/10 pb-6">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h3 className="text-2xl font-bold tracking-tight">
            {p.retrying ? "Retrying…" : "Generation failed"}
          </h3>
          <span className="bg-red-500/15 text-red-800 dark:text-red-200 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider">
            {p.retrying ? "Running" : `Failed ${p.attempts.length}×`}
          </span>
        </div>
        <SummaryMetaChips
          timestamp={p.summary.timestamp}
          model={p.summary.model}
          language={p.summary.language}
        />
      </div>

      <div className="mb-6">
        <ErrorHistory {...p} />
      </div>

      <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <RetryControls {...p} />
        <PasteButton {...p} />
      </div>

      <p className="text-sm text-app-ink/80 mb-4">
        The prompt is saved. Retry sends it again with the model you pick, or
        run it in another AI tool and paste the answer.
      </p>
      <PromptFold promptText={p.promptText} />
      <Counts summary={p.summary} />
    </>
  )
}

/** C: the error history, then the two ways out given equal room. */
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

      <div className="mb-6">
        <ErrorHistory {...p} />
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl border border-app-ink/10 p-5 flex flex-col gap-3">
          <h4 className="text-[11px] font-bold uppercase tracking-widest text-app-ink/70">
            Try again here
          </h4>
          <p className="text-sm text-app-ink/80 flex-1">
            Send the saved prompt again, to the same model or another one. The
            same window and posts, nothing re-collected.
          </p>
          <RetryControls {...p} />
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
            <PasteButton {...p} />
          </div>
        </div>
      </div>

      <PromptFold promptText={p.promptText} />
      <Counts summary={p.summary} />
    </>
  )
}
