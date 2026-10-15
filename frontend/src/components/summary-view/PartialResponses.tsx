import { ChevronDown } from "lucide-react"
import { useState } from "react"
import type { SummaryAttemptResponse } from "@/client"
import { TgButton } from "@/components/ui/tg-button"
import { formatSummaryModelLabel } from "@/constants"
import { RelativeTime } from "../RelativeTime"

type Handler = (attemptId: string) => void

export interface PartialResponsesProps {
  /** Every Attempt, oldest first; those holding text are the drafts. */
  attempts: SummaryAttemptResponse[]
  keyLabel: (keyId: string | null) => string | undefined
  onKeep: Handler
  onDismiss: Handler
  onRestore: Handler
}

/** How much of a draft shows before Show all. */
const PREVIEW_CHARS = 280

/**
 * The text cut-off or stopped Attempts produced (SFR-03), newest first. Each
 * can be kept as the Summary's text, which makes it Incomplete, or dismissed;
 * a dismissed one waits in a closed fold and can be restored.
 */
export function PartialResponses(props: PartialResponsesProps) {
  const drafts = props.attempts
    .filter((a) => a.outcome !== "running" && a.partialText)
    .reverse()
  const [open, setOpen] = useState(false)
  if (drafts.length === 0) return null
  const shown = drafts.filter((a) => a.partialDismissedAt === null)
  const dismissed = drafts.filter((a) => a.partialDismissedAt !== null)
  return (
    <section
      data-testid="partial-responses"
      className="rounded-2xl border border-app-ink/10 p-4 md:p-6"
    >
      <h4 className="mb-1 text-sm font-bold">Partial responses</h4>
      <p className="mb-4 text-sm text-app-ink/80">
        Text an Attempt wrote before it stopped. Keep one as this Summary's
        text; it is marked Incomplete and can still be retried.
      </p>
      <ol className="space-y-4">
        {shown.map((a, i) => (
          <Draft
            key={a.id}
            attempt={a}
            primary={i === 0}
            keyLabel={props.keyLabel}
            onKeep={() => props.onKeep(a.id)}
            onSet={() => props.onDismiss(a.id)}
            setLabel="Dismiss"
          />
        ))}
      </ol>
      {dismissed.length > 0 && (
        <div className="mt-4">
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
            Dismissed ({dismissed.length})
          </button>
          {open && (
            <ol className="ms-6 mt-2 space-y-4">
              {dismissed.map((a) => (
                <Draft
                  key={a.id}
                  attempt={a}
                  primary={false}
                  keyLabel={props.keyLabel}
                  onSet={() => props.onRestore(a.id)}
                  setLabel="Restore"
                />
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  )
}

function Draft({
  attempt,
  primary,
  keyLabel,
  onKeep,
  onSet,
  setLabel,
}: {
  attempt: SummaryAttemptResponse
  primary: boolean
  keyLabel: (keyId: string | null) => string | undefined
  /** Absent on a dismissed draft, which is restored before it is kept. */
  onKeep?: () => void
  onSet: () => void
  setLabel: string
}) {
  const [all, setAll] = useState(false)
  const text = attempt.partialText ?? ""
  const long = text.length > PREVIEW_CHARS
  const key = keyLabel(attempt.keyId)
  return (
    <li data-testid="partial-response" className="min-w-0">
      <p className="text-[11px] opacity-70">
        Attempt {attempt.attempt} · {formatSummaryModelLabel(attempt.model)}
        {key && ` · ${key}`} · {text.length.toLocaleString()} characters ·{" "}
        <RelativeTime timestamp={attempt.endedAt ?? attempt.startedAt} />
      </p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-app-ink/80">
        {all || !long ? text : `${text.slice(0, PREVIEW_CHARS)}…`}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {long && (
          <TgButton type="button" variant="link" onClick={() => setAll(!all)}>
            {all ? "Show less" : "Show all"}
          </TgButton>
        )}
        {onKeep && (
          <TgButton
            type="button"
            variant={primary ? "primary" : "secondary"}
            data-primary={primary ? "true" : "false"}
            onClick={onKeep}
          >
            Keep this draft
          </TgButton>
        )}
        <TgButton type="button" variant="secondary" onClick={onSet}>
          {setLabel}
        </TgButton>
      </div>
    </li>
  )
}
