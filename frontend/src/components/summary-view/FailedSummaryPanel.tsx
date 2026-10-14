import {
  AlertTriangle,
  Check,
  ChevronDown,
  ClipboardPaste,
  Copy,
  Server,
} from "lucide-react"
import { type ReactNode, useState } from "react"
import { toast } from "sonner"
import type { SummaryAttemptResponse } from "@/client"
import { TgButton } from "@/components/ui/tg-button"
import { TgIconButton } from "@/components/ui/tg-icon-button"
import { formatSummaryModelLabel } from "@/constants"
import type { Summary } from "@/types"
import { RelativeTime } from "../RelativeTime"
import { type ReaderZone, summaryScopeLine } from "./SummaryHeader"

export interface FailedSummaryPanelProps {
  summary: Summary
  /** The saved prompt; absent when the Generate broke before one existed. */
  promptText: string | undefined
  /** Every Attempt, oldest first, as `GET .../attempts` lists them. */
  attempts: SummaryAttemptResponse[]
  zone: ReaderZone
  /** An AI Key's label by id, for the Attempt lines. */
  keyLabel: (keyId: string | null) => string | undefined
  onPaste: () => void
}

function copyPrompt(promptText: string) {
  void navigator.clipboard.writeText(promptText)
  toast.success("Prompt copied.")
}

/**
 * A Summary whose latest Attempt did not finish (SFR-01): the finished
 * report's header with a Failed chip, the latest error with its attempt, the
 * earlier ones folded, and the copy-and-paste way out.
 */
export function FailedSummaryPanel(props: FailedSummaryPanelProps) {
  const { summary, promptText, zone } = props
  const failed = props.attempts.filter((a) => a.outcome === "failed")
  const latest = failed.at(-1)
  const earlier = failed.slice(0, -1).reverse()
  return (
    <>
      <FailedHeader
        summary={summary}
        promptText={promptText}
        zone={zone}
        failures={failed.length}
      />
      <div className="space-y-6">
        {latest && (
          <div
            role="alert"
            className="flex gap-3 rounded-lg border-l-4 border-red-500 bg-red-500/5 px-4 py-3 text-red-900 dark:text-red-100"
          >
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="break-words font-mono text-xs sm:text-sm">
                {latest.error}
              </p>
              <AttemptMeta attempt={latest} keyLabel={props.keyLabel} />
            </div>
          </div>
        )}
        {earlier.length > 0 && (
          <Fold title={`Earlier attempts (${earlier.length})`}>
            <ol className="space-y-3 border-s border-app-ink/10 ps-4">
              {earlier.map((a) => (
                <li key={a.id}>
                  <p className="break-words font-mono text-xs text-app-ink/70">
                    {a.error}
                  </p>
                  <AttemptMeta attempt={a} keyLabel={props.keyLabel} />
                </li>
              ))}
            </ol>
          </Fold>
        )}
        {promptText && (
          <section className="rounded-2xl border border-app-ink/10 p-4 md:p-6">
            <div className="mb-3 flex items-center gap-2">
              <Server size={14} />
              <h4 className="text-sm font-bold">Use another AI</h4>
            </div>
            <p className="mb-4 text-sm text-app-ink/80">
              Run the saved prompt in any AI tool, then paste its answer here to
              finish this Summary.
            </p>
            <div className="flex flex-wrap gap-2">
              <TgButton
                type="button"
                variant="secondary"
                onClick={() => copyPrompt(promptText)}
              >
                <Copy size={14} />
                Copy prompt
              </TgButton>
              <TgButton type="button" variant="primary" onClick={props.onPaste}>
                <ClipboardPaste size={14} />
                Paste response
              </TgButton>
            </div>
          </section>
        )}
      </div>
    </>
  )
}

function FailedHeader({
  summary,
  promptText,
  zone,
  failures,
}: {
  summary: Summary
  promptText: string | undefined
  zone: ReaderZone
  failures: number
}) {
  const [copied, setCopied] = useState(false)
  return (
    <header className="mb-6 border-b border-app-ink/10 pb-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="text-xl font-bold tracking-tight">Analysis Report</h3>
          <span className="rounded-md bg-red-500/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-red-800 dark:text-red-200">
            {failures > 1 ? `Failed ×${failures}` : "Failed"}
          </span>
        </div>
        {promptText && (
          <TgIconButton
            aria-label="Copy prompt"
            tooltip="Copies the saved prompt, to run in another AI tool."
            onClick={() => {
              copyPrompt(promptText)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </TgIconButton>
        )}
      </div>
      <p className="mt-1 break-words text-sm text-app-ink/80">
        {summaryScopeLine(summary, zone)}
      </p>
      <p className="mt-0.5 break-words text-xs text-app-ink/50">
        {formatSummaryModelLabel(summary.model)} · {summary.language} · started{" "}
        <RelativeTime timestamp={summary.timestamp} />
      </p>
    </header>
  )
}

function AttemptMeta({
  attempt,
  keyLabel,
}: {
  attempt: SummaryAttemptResponse
  keyLabel: (keyId: string | null) => string | undefined
}) {
  const key = keyLabel(attempt.keyId)
  return (
    <p className="mt-1 text-[11px] opacity-70">
      Attempt {attempt.attempt} · {formatSummaryModelLabel(attempt.model)}
      {key && ` · ${key}`}
      {attempt.kind === "limit" && " · no AI Key charged"}
      {attempt.automatic && " · automatic retry"} ·{" "}
      <RelativeTime timestamp={attempt.endedAt ?? attempt.startedAt} />
    </p>
  )
}

/** A chevron fold, like the report's sections. Closed by default. */
function Fold({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-sm font-bold text-app-ink/80 hover:text-app-ink"
      >
        <ChevronDown
          size={16}
          className={`text-app-ink/40 ${open ? "" : "-rotate-90"}`}
        />
        {title}
      </button>
      {open && <div className="ms-6 mt-2">{children}</div>}
    </section>
  )
}
