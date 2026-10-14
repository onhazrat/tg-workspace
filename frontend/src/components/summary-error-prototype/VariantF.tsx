/**
 * PROTOTYPE, throw away. Variant F, the chosen design: the finished report's
 * layout over attempts kept in their own storage (`attempts-api.ts`), so the
 * history survives a reload and reaches other devices, plus:
 *
 * - a `failed` state of its own: a pending Summary with no attempts is a Copy
 *   Prompt item and keeps today's panel; one whose latest attempt failed gets
 *   this page, and History says "Failed" instead of "Awaiting response";
 * - the retry runs on the server and the page watches it over SSE, so a reload
 *   or a closed tab does not cut it;
 * - one automatic retry for a transient failure, with a countdown and Cancel;
 * - every draft a dying stream produced, each with Keep, Dismiss and Restore;
 * - the saved prompt's size checked against the chosen model's context window.
 *
 * Runs and Keep draft are stubbed: they stream made-up text and record attempts.
 */
import { useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ClipboardPaste,
  Copy,
  FileText,
  Loader2,
  RotateCcw,
  Server,
  Undo2,
  X,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import { toast } from "sonner"
import { TgButton } from "@/components/ui/tg-button"
import { formatSummaryModelLabel } from "@/constants"
import { useAiKeys } from "@/hooks/useAiKeys"
import { RelativeTime } from "../RelativeTime"
import { PendingSummaryPanel } from "../summary-view/SummaryParts"
import {
  activeRunKey,
  contextFor,
  estimateTokens,
  retryAfterSeconds,
  type ServerAttempt,
  type ServerRun,
  startRun,
  useActiveRun,
  useAddAttempt,
  useAttempts,
  useContextLengths,
  useDismissDraft,
  useRestoreDraft,
  watchRun,
} from "./attempts-api"
import type { Attempt } from "./failure-store"
import { useFailureStore } from "./failure-store"
import {
  Card,
  copyPrompt,
  ErrorHistory,
  FailedHeader,
  Fold,
  type Props,
  RetryControls,
  SavedPrompt,
  useKeyModel,
} from "./PendingFailureVariants"

/** Window in which a transient failure still earns its one automatic retry. */
const AUTO_WINDOW_MS = 120_000
const AUTO_DEFAULT_S = 10

export function VariantF(props: Props) {
  const { data, isLoading, isError } = useAttempts(props.summary.id)
  if (isLoading) return null
  if (isError)
    return (
      <p className="text-sm text-red-600">
        Prototype attempts API unreachable. Start summary-attempts-proto-api.
      </p>
    )
  // Never attempted here: a Copy Prompt item, waiting by design.
  if (!data?.length) return <PendingSummaryPanel {...props} />
  return <Body {...props} rows={data} />
}

const toAttempt = (r: ServerAttempt): Attempt => ({
  error: r.error ?? "",
  model: r.model,
  keyId: r.keyId,
  at: r.at,
  auto: r.auto,
})

function Body(props: Props & { rows: ServerAttempt[] }) {
  const { rows, summary } = props
  const add = useAddAttempt(summary.id)
  const dismiss = useDismissDraft(summary.id)
  const { nextRetry } = useFailureStore()
  const _aiKeys = useAiKeys()
  const latest = rows[rows.length - 1]
  const km = useKeyModel(
    latest.model || summary.model || "",
    latest.keyId ?? summary.aiKeyId,
  )
  const failed = rows.filter((r) => r.outcome === "failed").map(toAttempt)
  const server = useServerRun(summary.id, true)
  const restore = useRestoreDraft(summary.id)

  const run = async (auto: boolean) => {
    const model = auto ? latest.model : km.model
    const keyId = auto ? latest.keyId : km.keyId
    await server.start({ outcome: nextRetry, model, keyId, auto })
  }

  const busy = server.live !== null
  const auto = useAutoRetry(latest, busy, () => void run(true))

  if (latest.outcome !== "failed")
    return <Resolved latest={latest} failed={failed} />

  // Every draft a dying stream left, newest first, until it is dismissed.
  const drafts = rows
    .filter((r) => r.outcome === "failed" && r.partialText && !r.draftDismissed)
    .reverse()
  const dismissed = rows
    .filter((r) => r.outcome === "failed" && r.partialText && r.draftDismissed)
    .reverse()
  const p = {
    ...props,
    attempts: failed,
    retrying: busy,
    model: server.live?.model ?? km.model,
    setModel: km.setModel,
    keyId: km.keyId,
    setKeyId: km.setKeyId,
    retry: () => void run(false),
  }
  return (
    <>
      <FailedHeader {...p} />
      <div className="space-y-6">
        <ErrorHistory {...p} />
        {auto.secondsLeft !== null && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
            <Loader2
              size={16}
              className="hidden sm:block shrink-0 animate-spin"
            />
            <p className="flex-1">
              Retrying automatically in <b>{auto.secondsLeft}s</b> with{" "}
              {formatSummaryModelLabel(latest.model)}. Overloads and dropped
              connections usually pass.
            </p>
            <TgButton
              type="button"
              variant="secondary"
              size="sm"
              onClick={auto.cancel}
            >
              Cancel
            </TgButton>
          </div>
        )}
        {server.live && <LiveRun run={server.live} attempt={rows.length + 1} />}
        {(drafts.length > 0 || dismissed.length > 0) && (
          <Drafts
            drafts={drafts}
            dismissed={dismissed}
            onRestore={async (id) => {
              await restore(id)
              toast("Draft restored.")
            }}
            retrying={p.retrying}
            onDismiss={dismiss}
            onKeep={async (draft) => {
              auto.cancel()
              await add({
                outcome: "kept_draft",
                kind: null,
                error: null,
                model: draft.model,
                keyId: draft.keyId,
                partialText: draft.partialText,
                auto: false,
              })
              toast.success(
                `Stub: draft from attempt ${draft.attempt} kept. The real build saves it as this Summary's text, marked incomplete.`,
              )
            }}
          />
        )}
        <div className="grid md:grid-cols-2 gap-4">
          <Card icon={<RotateCcw size={14} />} title="Try again">
            <RetryControls
              {...p}
              note={<SizeCheck promptText={p.promptText} model={km.model} />}
            />
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

/**
 * One automatic retry per transient failure: never for an attempt that was
 * itself automatic, never for an old failure found on reload, and never after
 * Cancel. Waits what the provider asked, else ten seconds.
 */
function useAutoRetry(latest: ServerAttempt, busy: boolean, fire: () => void) {
  const [cancelled, setCancelled] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const fireRef = useRef(fire)
  fireRef.current = fire
  const eligible =
    latest.outcome === "failed" &&
    latest.kind === "transient" &&
    !latest.auto &&
    Date.now() - latest.at < AUTO_WINDOW_MS &&
    cancelled !== latest.id &&
    !busy
  useEffect(() => {
    if (!eligible) {
      setSecondsLeft(null)
      return
    }
    const wait = retryAfterSeconds(latest.error ?? "") ?? AUTO_DEFAULT_S
    const due = latest.at + wait * 1000
    let timer: ReturnType<typeof setInterval> | undefined
    const tick = () => {
      const left = Math.ceil((due - Date.now()) / 1000)
      if (left > 0) return setSecondsLeft(left)
      clearInterval(timer)
      setSecondsLeft(null)
      fireRef.current()
    }
    timer = setInterval(tick, 250)
    tick()
    return () => clearInterval(timer)
  }, [eligible, latest.at, latest.error])
  return { secondsLeft, cancel: () => setCancelled(latest.id) }
}

/** Every undismissed draft, newest first, each with Keep and Dismiss. */
function Drafts({
  drafts,
  dismissed,
  retrying,
  onKeep,
  onDismiss,
  onRestore,
}: {
  drafts: ServerAttempt[]
  dismissed: ServerAttempt[]
  retrying: boolean
  onKeep: (draft: ServerAttempt) => void
  onDismiss: (attemptId: string) => Promise<void>
  onRestore: (attemptId: string) => Promise<void>
}) {
  return (
    <Card
      icon={<FileText size={14} />}
      title={`Drafts from failed attempts (${drafts.length})`}
    >
      <p className="text-xs text-app-ink/60 mb-4">
        Text the model wrote before its stream stopped. Keep one as this
        Summary's text, or dismiss the ones you don't need.
      </p>
      <ol className="space-y-6">
        {drafts.map((d, i) => (
          <DraftItem
            key={d.id}
            draft={d}
            newest={i === 0}
            retrying={retrying}
            onKeep={() => onKeep(d)}
            onDismiss={async () => {
              await onDismiss(d.id)
              toast(`Draft from attempt ${d.attempt} dismissed.`)
            }}
          />
        ))}
      </ol>
      {dismissed.length > 0 && (
        <div
          className={
            drafts.length ? "mt-6 border-t border-app-ink/10 pt-4" : ""
          }
        >
          <Fold title={`Dismissed drafts (${dismissed.length})`}>
            <ol className="space-y-6">
              {dismissed.map((d) => (
                <DraftItem
                  key={d.id}
                  draft={d}
                  newest={false}
                  retrying={retrying}
                  onRestore={() => void onRestore(d.id)}
                />
              ))}
            </ol>
          </Fold>
        </div>
      )}
    </Card>
  )
}

function DraftItem({
  draft,
  newest,
  retrying,
  onKeep,
  onDismiss,
  onRestore,
}: {
  draft: ServerAttempt
  newest: boolean
  retrying: boolean
  onKeep?: () => void
  onDismiss?: () => void
  /** A dismissed draft offers Restore instead of Keep and Dismiss. */
  onRestore?: () => void
}) {
  const [open, setOpen] = useState(false)
  const text = draft.partialText ?? ""
  const words = text.split(/\s+/).filter(Boolean).length
  return (
    <li className="border-t border-app-ink/10 pt-4 first:border-0 first:pt-0">
      <p className="text-[11px] font-bold uppercase tracking-widest text-app-ink/60 mb-2">
        Attempt {draft.attempt} · {formatSummaryModelLabel(draft.model)} · about{" "}
        {words} words · <RelativeTime timestamp={draft.at} />
      </p>
      <div className="relative">
        <div
          dir="auto"
          className={`prose prose-sm max-w-none dark:prose-invert prose-p:text-app-ink/80 prose-li:text-app-ink/80 ${
            open ? "" : "max-h-32 overflow-hidden"
          }`}
        >
          <ReactMarkdown>{`${text} …`}</ReactMarkdown>
        </div>
        {!open && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-app-card to-transparent" />
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {onRestore ? (
          <TgButton
            type="button"
            variant="secondary"
            size="lg"
            className="h-11 px-5"
            onClick={onRestore}
          >
            <Undo2 size={14} />
            Restore
          </TgButton>
        ) : (
          <TgButton
            type="button"
            variant={newest ? "primary" : "secondary"}
            size="lg"
            className="col-span-2 h-11 px-5"
            disabled={retrying}
            onClick={onKeep}
          >
            <CheckCircle2 size={14} />
            Keep this draft
          </TgButton>
        )}
        <TgButton
          type="button"
          variant="secondary"
          size="lg"
          className="h-11 px-5"
          onClick={() => setOpen(!open)}
        >
          {open ? "Show less" : "Show all"}
        </TgButton>
        {onDismiss && (
          <TgButton
            type="button"
            variant="ghost"
            size="lg"
            className="h-11 px-5"
            onClick={onDismiss}
          >
            <X size={14} />
            Dismiss
          </TgButton>
        )}
      </div>
    </li>
  )
}

/** A stubbed success or kept draft: the real build shows the report instead. */
function Resolved({
  latest,
  failed,
}: {
  latest: ServerAttempt
  failed: Attempt[]
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border-l-4 border-emerald-500 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-900 dark:text-emerald-100 flex gap-3">
        <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
        <p>
          {latest.outcome === "kept_draft"
            ? `Draft kept after ${failed.length} failed attempts.`
            : `Attempt ${latest.attempt} succeeded on ${formatSummaryModelLabel(latest.model)}.`}{" "}
          Stub: the real build shows the report here; this Summary is still
          pending on the server.
        </p>
      </div>
      {failed.length > 0 && (
        <Fold title={`Failed attempts (${failed.length})`}>
          <ErrorHistory
            attempts={failed}
            retrying={false}
            model={latest.model}
          />
        </Fold>
      )}
    </div>
  )
}

/**
 * F: the retry runs on the server. Start it, then watch it over SSE; a page
 * opened while it runs finds it and attaches, so closing the tab costs nothing.
 */
function useServerRun(summaryId: string, enabled: boolean) {
  const qc = useQueryClient()
  const active = useActiveRun(summaryId, enabled)
  const [live, setLive] = useState<ServerRun | null>(null)
  const running = active.data?.status === "running" ? active.data : null
  useEffect(() => {
    if (!running) return
    const ctrl = new AbortController()
    void (async () => {
      try {
        for await (const ev of watchRun(running.id, ctrl.signal)) {
          setLive(ev)
          if (ev.status !== "done") continue
          const a = ev.attempt
          if (a?.outcome === "succeeded")
            toast.success(`Attempt ${a.attempt} succeeded on the server.`)
          else if (a) toast.error(`Attempt ${a.attempt} failed on the server.`)
          await qc.invalidateQueries({
            predicate: (q) => String(q.queryKey[0]).startsWith("proto-"),
          })
          setLive(null)
        }
      } catch {
        // Aborted: the page left; the run goes on without it.
      }
    })()
    return () => ctrl.abort()
  }, [running?.id, qc, running])
  return {
    live: live ?? running,
    start: async (body: Parameters<typeof startRun>[1]) => {
      try {
        const run = await startRun(summaryId, body)
        qc.setQueryData(activeRunKey(summaryId), run)
      } catch {
        toast.error("A run is already going for this Summary.")
      }
    },
  }
}

function LiveRun({ run, attempt }: { run: ServerRun; attempt: number }) {
  const words = run.text.split(/\s+/).filter(Boolean).length
  return (
    <Card
      icon={<Server size={14} />}
      title={`Attempt ${attempt} is running on the server`}
    >
      <p className="text-xs text-app-ink/60 mb-3">
        {formatSummaryModelLabel(run.model)}
        {run.auto && " · automatic retry"} · started{" "}
        <RelativeTime timestamp={run.startedAt} />
        {words > 0 && ` · ${words} words so far`}. Closing this tab does not
        stop it; open the Summary again and it picks up here.
      </p>
      {run.text ? (
        <div
          dir="auto"
          className="prose prose-sm max-w-none dark:prose-invert prose-p:text-app-ink/80 prose-li:text-app-ink/80 max-h-80 overflow-y-auto custom-scrollbar"
        >
          <ReactMarkdown>{`${run.text} ▍`}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-sm flex items-center gap-2 text-app-ink/70">
          <Loader2 size={14} className="animate-spin" />
          Waiting for the provider…
        </p>
      )}
    </Card>
  )
}

/**
 * F: the saved prompt's size against the chosen model's context window, so a
 * retry that cannot fit is flagged before it is sent. ~4 characters a token,
 * the backend's own estimate.
 */
function SizeCheck({
  promptText,
  model,
}: {
  promptText: string | undefined
  model: string
}) {
  const lengths = useContextLengths(true).data
  if (!promptText) return null
  const est = estimateTokens(promptText)
  const ctx = contextFor(model, lengths)
  const n = (x: number) => x.toLocaleString()
  if (ctx === null)
    return (
      <p className="text-xs text-app-ink/60">
        The saved prompt is ~{n(est)} tokens. This model's context size is
        unknown.
      </p>
    )
  if (est > ctx)
    return (
      <p className="flex gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-900 dark:text-red-100">
        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
        <span>
          Won't fit: the saved prompt is ~{n(est)} tokens and this model takes{" "}
          {n(ctx)}. Pick a model with a larger context window.
        </span>
      </p>
    )
  if (est > ctx * 0.8)
    return (
      <p className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
        <span>
          Tight: ~{n(est)} of {n(ctx)} tokens, leaving little room for the
          answer.
        </span>
      </p>
    )
  return (
    <p className="flex items-center gap-1.5 text-xs text-app-ink/60">
      <Check size={12} />
      The saved prompt is ~{n(est)} tokens; this model takes {n(ctx)}.
    </p>
  )
}
