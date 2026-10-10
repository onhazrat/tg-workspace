import type React from "react"

import type { SummaryTextSize } from "@/lib/settings/schema"
import { summaryMetadataText } from "@/lib/summaries/summary-model"
import type { BotCredential, ChatDestination, Summary } from "@/types"
import { PublishMetadataPanel } from "./PublishMetadataPanel"
import {
  FoldableSections,
  PROSE_SIZE,
  ReadingControls,
} from "./ReadingControls"
import { type ReaderZone, SummaryHeader } from "./SummaryHeader"
import { SummaryNote } from "./SummaryNote"
import { GeneratingSkeleton, PendingSummaryPanel } from "./SummaryParts"
import { PublishControls, TelegramLengthHint } from "./SummaryToolbar"
import { telegramMessageLength } from "./summary-text"

export interface SummaryBodyProps {
  summary: Summary | null | undefined
  promptText: string | undefined
  body: string | null
  isPending: boolean
  summarizing: boolean
  running: boolean
  direction: { dir: string; className: string }
  bots: BotCredential[]
  destinations: ChatDestination[]
  onPublish: (bot: BotCredential, dest: ChatDestination, text: string) => void
  onRerun: () => void
  onPaste: () => void
  editingNote: boolean
  onEditingNoteChange: (editing: boolean) => void
  onSaveNote: (note: string) => Promise<void>
  onDeleteNote: () => Promise<void>
  sendMetadata: boolean
  metadataText: string
  metadataToSend: string | null
  onSendMetadataChange: (send: boolean) => void
  onMetadataTextChange: (text: string) => void
  onSaveMetadata: (text: string) => Promise<void>
  /** Renders report Markdown; a slot because its paragraphs read the workspace. */
  renderMarkdown: (markdown: string) => React.ReactNode
  /** `ArtifactScopeLine`; a slot because it reads the workspace contexts. */
  scopeLine: (summary: Summary, className?: string) => React.ReactNode
  /** Shown with no result; a slot because it reads `useUI`. */
  emptyState: React.ReactNode
  /** The zone the header writes the Analysis window in. */
  zone: ReaderZone
  textSize: SummaryTextSize
  onTextSizeChange: (size: SummaryTextSize) => void
}

/** The Summary card's contents: pending, report, generating or empty. */
export function SummaryBody(props: SummaryBodyProps) {
  const { summary, body, scopeLine } = props
  if (props.isPending && summary)
    return (
      <>
        <PendingSummaryPanel
          summary={summary}
          promptText={props.promptText}
          onPaste={props.onPaste}
        />
        {/*
         * The frozen Analysis window, exact on both ends and never the
         * workspace's own (AW-08). The workspace one moves; this Summary
         * was made from these two instants and no others.
         */}
        {scopeLine(summary, "mt-3")}
      </>
    )
  if (body)
    return (
      <>
        <SummaryHeader
          summary={summary}
          body={body}
          zone={props.zone}
          editingNote={props.editingNote}
          onToggleNote={() => props.onEditingNoteChange(!props.editingNote)}
          running={props.running}
          onRerun={props.onRerun}
        />
        {/* The old publish controls, until SUMTAB-09's publish panel replaces them. */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <PublishControls
            bots={props.bots}
            destinations={props.destinations}
            onPublish={(bot, dest) => props.onPublish(bot, dest, body)}
          />
          <TelegramLengthHint
            length={telegramMessageLength(body, props.metadataToSend)}
          />
        </div>
        <ReadingControls
          textSize={props.textSize}
          onTextSizeChange={props.onTextSizeChange}
        />
        <div
          dir={props.direction.dir}
          className={`prose ${PROSE_SIZE[props.textSize]} max-w-none prose-headings:tracking-tight prose-headings:font-bold prose-p:leading-relaxed prose-p:text-app-ink/80 prose-li:text-app-ink/80 prose-li:my-1 dark:prose-invert ${props.direction.className}`}
        >
          <FoldableSections markdown={body} render={props.renderMarkdown} />
        </div>

        {summary && (
          <>
            <SummaryNote
              note={summary.note}
              editing={props.editingNote}
              onEditingChange={props.onEditingNoteChange}
              onSave={props.onSaveNote}
              onDelete={props.onDeleteNote}
            />
            <PublishMetadataPanel
              send={props.sendMetadata}
              text={props.metadataText}
              savedText={summaryMetadataText(summary)}
              onSendChange={props.onSendMetadataChange}
              onTextChange={props.onMetadataTextChange}
              onSave={props.onSaveMetadata}
            />
            {/*
             * The Summary's own window, not the workspace's (AW-08), kept
             * here for its "Use this Scope" action; the counts are in the
             * header now.
             */}
            {scopeLine(summary, "mt-12 pt-6 border-t border-app-ink/10")}
          </>
        )}
      </>
    )
  if (props.summarizing) return <GeneratingSkeleton />
  /*
   * A result tab with no result (AW-09).
   *
   * It said "Ready to Summarize" and then described a create path that
   * has not been on this tab since Action took the four forms. Naming
   * where work starts is the same answer Tag, Discover and Chat give.
   */
  return props.emptyState
}
