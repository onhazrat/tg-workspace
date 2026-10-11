import { Check, Copy, Download, RefreshCw, StickyNote } from "lucide-react"
import { useState } from "react"
import { TgIconButton } from "@/components/ui/tg-icon-button"
import { formatSummaryModelLabel } from "@/constants"
import { scopeChannels, scopeRange } from "@/lib/scope/artifact-scope"
import { formatElapsed } from "@/lib/scope/window"
import type { Summary } from "@/types"
import { RelativeTime } from "../RelativeTime"
import { exportFilename } from "./summary-text"

/** The reader's zone and locale; `locale` is the browser's when omitted. */
export interface ReaderZone {
  timeZone: string
  locale?: string
}

/** `Asia/Tehran` → `Tehran`, `America/Argentina/Buenos_Aires` → `Buenos Aires`. */
function zoneCity(timeZone: string): string {
  return (timeZone.split("/").pop() ?? timeZone).replaceAll("_", " ")
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`

/**
 * `3h · Oct 7, 2026, 9:27 AM – 12:27 PM (Tehran) · 51 channels · 447 posts`.
 *
 * The locale's range formatter writes a shared date once. The post count is
 * the Covered Posts, omitted when none are on record: that is not zero.
 */
export function summaryScopeLine(summary: Summary, zone: ReaderZone): string {
  const range = scopeRange(summary)
  const window =
    range && range.end > range.start
      ? `${formatElapsed(range.end - range.start)} · ${new Intl.DateTimeFormat(
          zone.locale,
          { dateStyle: "medium", timeStyle: "short", timeZone: zone.timeZone },
        ).formatRange(range.start, range.end)} (${zoneCity(zone.timeZone)})`
      : "Analysis window not recorded"
  const covered = summary.scope?.scopedPostCount
  return [
    window,
    plural(scopeChannels(summary).length, "channel"),
    ...(covered == null ? [] : [plural(covered, "post")]),
  ].join(" · ")
}

/** Title, icon actions, then the Scope line and the provenance line. */
export function SummaryHeader({
  summary,
  body,
  zone,
  editingNote,
  onToggleNote,
  running,
  onRerun,
}: {
  summary: Summary | null | undefined
  body: string
  zone: ReaderZone
  editingNote: boolean
  onToggleNote: () => void
  running: boolean
  onRerun: () => void
}) {
  const [copied, setCopied] = useState(false)
  const noteLabel = editingNote
    ? "Close note"
    : summary?.note
      ? "Edit note"
      : "Add note"
  return (
    <header className="mb-6 border-b border-app-ink/10 pb-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-xl font-bold tracking-tight">
          Analysis Report
        </h3>
        <div className="flex shrink-0 items-center gap-0.5">
          {summary && (
            <TgIconButton
              aria-label={noteLabel}
              tooltip={noteLabel}
              onClick={onToggleNote}
              className={summary.note ? "text-amber-600" : undefined}
            >
              <StickyNote
                size={16}
                className={editingNote || summary.note ? "fill-current" : ""}
              />
            </TgIconButton>
          )}
          <TgIconButton
            aria-label="Re-analyze window"
            tooltip="Re-analyzes the current time window."
            onClick={onRerun}
            loading={running}
          >
            <RefreshCw size={16} />
          </TgIconButton>
          <TgIconButton
            aria-label={copied ? "Copied" : "Copy text"}
            tooltip="Copies the summary text to your clipboard."
            onClick={() => {
              void navigator.clipboard.writeText(body)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </TgIconButton>
          <TgIconButton
            aria-label="Export Markdown"
            tooltip="Downloads the summary as a Markdown file."
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([body], { type: "text/markdown" }),
              )
              const a = document.createElement("a")
              a.href = url
              a.download = exportFilename(new Date())
              a.click()
              URL.revokeObjectURL(url)
            }}
          >
            <Download size={16} />
          </TgIconButton>
        </div>
      </div>
      {summary && (
        <>
          <p className="mt-1 break-words text-sm text-app-ink/80">
            {summaryScopeLine(summary, zone)}
          </p>
          <p className="mt-0.5 break-words text-xs text-app-ink/50">
            {formatSummaryModelLabel(summary.model)} · {summary.language} ·{" "}
            <RelativeTime timestamp={summary.timestamp} />
          </p>
        </>
      )}
    </header>
  )
}
