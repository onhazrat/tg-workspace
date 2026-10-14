/**
 * PROTOTYPE, throw away. The pending Summary panel showing a failed
 * generation, its error history, and a Retry with a model of your choice.
 * Retry is stubbed (`failure-store.ts`).
 *
 * C borrows the finished report's layout: the same header (title, icon
 * actions, Scope line, provenance line), chevron folds like the report's
 * sections, and bordered cards like Publish to Telegram.
 */
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ClipboardPaste,
  Copy,
  Loader2,
  RotateCcw,
} from "lucide-react"
import { type ReactNode, useState } from "react"
import { toast } from "sonner"
import { ModelCombo } from "@/components/ai/ModelCombo"
import { TgButton } from "@/components/ui/tg-button"
import { TgIconButton } from "@/components/ui/tg-icon-button"
import { tgFieldClassName } from "@/components/ui/tg-input"
import { formatSummaryModelLabel } from "@/constants"
import { useSettings } from "@/contexts/SettingsContext"
import type { Summary } from "@/types"
import { RelativeTime } from "../RelativeTime"
import { summaryScopeLine } from "../summary-view/SummaryHeader"
import { PendingSummaryPanel } from "../summary-view/SummaryParts"
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
  return <VariantC {...shared} />
}

type VariantProps = Props & {
  attempts: Attempt[]
  retrying: boolean
  model: string
  setModel: (m: string) => void
  retry: () => void
}

export const LABEL =
  "text-[11px] font-bold uppercase tracking-widest text-app-ink/60"

/** A bordered section with an icon title, like Publish to Telegram. */
export function Card({
  icon,
  title,
  children,
  className = "",
}: {
  icon: ReactNode
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-2xl border border-app-ink/10 p-4 md:p-6 ${className}`}
    >
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <h4 className="text-sm font-bold">{title}</h4>
      </div>
      {children}
    </section>
  )
}

/** A chevron fold, like the report's sections. Closed by default. */
export function Fold({
  title,
  children,
}: {
  title: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-sm font-bold text-app-ink/80 hover:text-app-ink"
      >
        <span className="rounded p-0.5 text-app-ink/40">
          <ChevronDown size={16} className={open ? "" : "-rotate-90"} />
        </span>
        {title}
      </button>
      {open && <div className="mt-2 ms-6">{children}</div>}
    </section>
  )
}

export function RetryControls({
  model,
  setModel,
  retrying,
  retry,
  label = "Retry",
  primary = true,
}: {
  primary?: boolean
  model: string
  setModel: (m: string) => void
  retrying: boolean
  retry: () => void
  label?: string
}) {
  return (
    <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>Model</span>
        <ModelCombo
          ariaLabel="Model for the retry"
          value={model}
          onChange={setModel}
          remember={false}
          className={`${tgFieldClassName} sm:w-64 h-11`}
        />
      </label>
      <TgButton
        type="button"
        variant={primary ? "primary" : "secondary"}
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

/** The latest error up front, every earlier one in a fold, newest first. */
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
        <div
          role="alert"
          className="rounded-lg border-l-4 border-red-500 bg-red-500/5 px-4 py-3 text-red-900 dark:text-red-100 flex gap-3"
        >
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-mono break-words">
              {latest.error}
            </p>
            <AttemptMeta n={attempts.length} attempt={latest} />
          </div>
        </div>
      )}
      {earlier.length > 0 && (
        <Fold title={`Earlier attempts (${earlier.length})`}>
          <ol className="space-y-3 border-s border-app-ink/10 ps-4">
            {earlier.map((a, i) => (
              <li key={a.at}>
                <p className="text-xs font-mono break-words text-app-ink/70">
                  {a.error}
                </p>
                <AttemptMeta n={attempts.length - 1 - i} attempt={a} />
              </li>
            ))}
          </ol>
        </Fold>
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

function copyPrompt(promptText: string | undefined) {
  if (!promptText) return false
  void navigator.clipboard.writeText(promptText)
  toast.success("Prompt copied.")
  return true
}

/**
 * The finished report's header, with the run's state where the report's title
 * stands alone: icon actions, the Scope line, then model · language · time.
 */
function FailedHeader(p: VariantProps) {
  const settings = useSettings()
  const [copied, setCopied] = useState(false)
  const zone = {
    timeZone:
      settings.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
  return (
    <header className="mb-6 border-b border-app-ink/10 pb-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="text-xl font-bold tracking-tight">Analysis Report</h3>
          <span
            className={`px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider ${
              p.retrying
                ? "bg-amber-500/15 text-amber-800 dark:text-amber-200"
                : "bg-red-500/15 text-red-800 dark:text-red-200"
            }`}
          >
            {p.retrying
              ? "Retrying"
              : p.attempts.length > 1
                ? `Failed ${p.attempts.length}×`
                : "Failed"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <TgIconButton
            aria-label={copied ? "Copied" : "Copy prompt"}
            tooltip="Copies the saved prompt, to run in another AI tool."
            disabled={!p.promptText}
            onClick={() => {
              if (!copyPrompt(p.promptText)) return
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </TgIconButton>
        </div>
      </div>
      <p className="mt-1 break-words text-sm text-app-ink/80">
        {summaryScopeLine(p.summary, zone)}
      </p>
      <p className="mt-0.5 break-words text-xs text-app-ink/50">
        {formatSummaryModelLabel(p.summary.model)} · {p.summary.language} ·
        started <RelativeTime timestamp={p.summary.timestamp} />
      </p>
    </header>
  )
}

function SavedPrompt({ promptText }: { promptText: string | undefined }) {
  return (
    <Fold title="Saved prompt">
      <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed text-app-ink/80 max-h-[480px] overflow-y-auto custom-scrollbar rounded-xl border border-app-ink/10 bg-app-muted/10 p-4">
        {promptText ?? "Loading prompt…"}
      </pre>
    </Fold>
  )
}

/** C: the same header, then the two ways out as cards side by side. */
function VariantC(p: VariantProps) {
  return (
    <>
      <FailedHeader {...p} />
      <div className="space-y-6">
        <ErrorHistory {...p} />
        <div className="grid md:grid-cols-2 gap-4">
          <Card icon={<RotateCcw size={14} />} title="Try again">
            <RetryControls {...p} />
            <p className="mt-3 text-xs text-app-ink/60">
              The same window and posts, nothing re-collected.
            </p>
          </Card>
          <Card icon={<ClipboardPaste size={14} />} title="Use another AI">
            <p className="text-sm text-app-ink/80 mb-4">
              Copy the saved prompt into any AI tool, then paste its answer
              here.
            </p>
            <div className="grid gap-2 sm:flex sm:flex-wrap">
              <TgButton
                type="button"
                variant="secondary"
                size="lg"
                className="h-11 px-5"
                disabled={!p.promptText}
                onClick={() => copyPrompt(p.promptText)}
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
          </Card>
        </div>
        <SavedPrompt promptText={p.promptText} />
      </div>
    </>
  )
}
