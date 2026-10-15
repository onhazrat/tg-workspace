import {
  AlertTriangle,
  Check,
  ChevronDown,
  ClipboardPaste,
  Copy,
  Crosshair,
  Loader2,
  RotateCcw,
  Server,
  Square,
} from "lucide-react"
import { type ReactNode, useState } from "react"
import { toast } from "sonner"
import type { SummaryAttemptResponse } from "@/client"
import { TgButton } from "@/components/ui/tg-button"
import { TgIconButton } from "@/components/ui/tg-icon-button"
import { formatSummaryModelLabel } from "@/constants"
import type { Summary } from "@/types"
import { RelativeTime } from "../RelativeTime"
import { PartialResponses } from "./PartialResponses"
import { RetryCountdown } from "./RetryCountdown"
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
  /** The running Attempt's text so far, as the watch delivers it (SFR-02). */
  runningText: string
  /** Start an Attempt on the Key and model the chips name. */
  onRetry: () => void
  /** The retry's Key and Model chips and size warning (SFR-04). */
  runWith?: ReactNode
  onStop: (attemptId: string) => void
  /** Withdraw the automatic retry while it counts down (SFR-03). */
  onCancel: (attemptId: string) => void
  /** Keep, dismiss or restore an Attempt's Partial response (SFR-03). */
  onKeep: (attemptId: string) => void
  onDismiss: (attemptId: string) => void
  onRestore: (attemptId: string) => void
  /** Put this Summary's Scope in the workspace, to narrow it. */
  onChangeSelection: () => void
}

function copyPrompt(promptText: string) {
  void navigator.clipboard.writeText(promptText)
  toast.success("Prompt copied.")
}

/**
 * A Summary whose latest Attempt did not finish (SFR-01): the finished
 * report's header with a Failed chip, the latest error with its attempt, the
 * earlier ones folded, and the ways out. SFR-02 adds Retry on the worker, the
 * running Attempt streaming in with Stop, and "Change selection" leading when
 * the selection was too large to send at all. SFR-03 adds the automatic
 * retry's countdown and the Partial responses.
 */
export function FailedSummaryPanel(props: FailedSummaryPanelProps) {
  const { summary, promptText, zone } = props
  const failed = props.attempts.filter((a) => a.outcome === "failed")
  const running = props.attempts.find((a) => a.outcome === "running")
  const latest = failed.at(-1)
  const earlier = failed.slice(0, -1).reverse()
  const tooLarge = latest?.kind === "limit"
  return (
    <>
      <FailedHeader
        summary={summary}
        promptText={promptText}
        zone={zone}
        failures={failed.length}
        running={!!running}
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
        {running && (
          <RetryCountdown
            startsAt={running.startedAt}
            onCancel={() => props.onCancel(running.id)}
          >
            <RunningAttemptCard
              attempt={running}
              text={props.runningText}
              keyLabel={props.keyLabel}
              onStop={() => props.onStop(running.id)}
            />
          </RetryCountdown>
        )}
        <PartialResponses
          attempts={props.attempts}
          keyLabel={props.keyLabel}
          onKeep={props.onKeep}
          onDismiss={props.onDismiss}
          onRestore={props.onRestore}
        />
        {running ? null : tooLarge ? (
          <ChangeSelectionCard onChangeSelection={props.onChangeSelection} />
        ) : (
          <TryAgainCard
            next={(props.attempts.at(-1)?.attempt ?? 0) + 1}
            last={props.attempts.at(-1)}
            model={summary.model}
            keyLabel={props.keyLabel}
            onRetry={props.onRetry}
            runWith={props.runWith}
          />
        )}
        {promptText && !tooLarge && (
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
  running,
}: {
  summary: Summary
  promptText: string | undefined
  zone: ReaderZone
  failures: number
  running: boolean
}) {
  const [copied, setCopied] = useState(false)
  return (
    <header className="mb-6 border-b border-app-ink/10 pb-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="text-xl font-bold tracking-tight">Analysis Report</h3>
          {running && failures === 0 ? (
            <span className="rounded-md bg-app-ink/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider">
              Generating
            </span>
          ) : (
            <span className="rounded-md bg-red-500/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-red-800 dark:text-red-200">
              {failures > 1 ? `Failed ×${failures}` : "Failed"}
            </span>
          )}
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

const CARD = "rounded-2xl border border-app-ink/10 p-4 md:p-6"

/** The Attempt the worker is running, its text arriving as it is written. */
export function RunningAttemptCard({
  attempt,
  text,
  keyLabel,
  onStop,
}: {
  attempt: SummaryAttemptResponse
  text: string
  keyLabel: (keyId: string | null) => string | undefined
  onStop: () => void
}) {
  const key = keyLabel(attempt.keyId)
  return (
    <section data-testid="running-attempt" className={CARD}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Loader2 size={14} className="shrink-0 animate-spin" />
          <h4 className="text-sm font-bold">
            Attempt {attempt.attempt} is running
          </h4>
        </div>
        <TgButton type="button" variant="secondary" onClick={onStop}>
          <Square size={12} />
          Stop
        </TgButton>
      </div>
      <p className="mb-3 text-[11px] opacity-70">
        {formatSummaryModelLabel(attempt.model)}
        {key && ` · ${key}`} · keeps going if you close this tab
      </p>
      <p className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words text-sm text-app-ink/80">
        {text || "Waiting for the first words…"}
      </p>
    </section>
  )
}

function TryAgainCard({
  next,
  last,
  model,
  keyLabel,
  onRetry,
  runWith,
}: {
  next: number
  last: SummaryAttemptResponse | undefined
  model: string | undefined
  keyLabel: (keyId: string | null) => string | undefined
  onRetry: () => void
  runWith: ReactNode
}) {
  const key = last ? keyLabel(last.keyId) : undefined
  return (
    <section data-testid="try-again" className={CARD}>
      <h4 className="mb-2 text-sm font-bold">Try again</h4>
      <p className="mb-4 text-sm text-app-ink/80">
        Runs Attempt {next}
        {!runWith && (
          <>
            {" "}
            on {formatSummaryModelLabel(last?.model ?? model)}
            {key && ` · ${key}`}
          </>
        )}
        . It keeps going if you close this tab.
      </p>
      {runWith}
      <TgButton type="button" variant="primary" onClick={onRetry}>
        <RotateCcw size={14} />
        Retry
      </TgButton>
    </section>
  )
}

function ChangeSelectionCard({
  onChangeSelection,
}: {
  onChangeSelection: () => void
}) {
  return (
    <section data-testid="change-selection-card" className={CARD}>
      <h4 className="mb-2 text-sm font-bold">The selection is too large</h4>
      <p className="mb-4 text-sm text-app-ink/80">
        Narrow the channels, the Analysis window or the selected Posts, then
        generate again. No AI Key was charged.
      </p>
      <TgButton type="button" variant="primary" onClick={onChangeSelection}>
        <Crosshair size={14} />
        Change selection
      </TgButton>
    </section>
  )
}

/**
 * A finished Summary's Attempts, when it took more than one (SFR-02), newest
 * first. One that worked first time shows nothing, as it always did.
 */
export function AttemptsFold({
  attempts,
  keyLabel,
}: {
  attempts: SummaryAttemptResponse[]
  keyLabel: (keyId: string | null) => string | undefined
}) {
  if (attempts.length < 2) return null
  return (
    <Fold title={`Attempts (${attempts.length})`}>
      <ol className="space-y-3 border-s border-app-ink/10 ps-4">
        {[...attempts].reverse().map((a) => (
          <li key={a.id}>
            <p className="break-words font-mono text-xs text-app-ink/70">
              {a.error ?? a.outcome}
            </p>
            <AttemptMeta attempt={a} keyLabel={keyLabel} />
          </li>
        ))}
      </ol>
    </Fold>
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
