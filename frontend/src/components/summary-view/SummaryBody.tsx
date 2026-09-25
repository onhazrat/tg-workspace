import type React from "react"

import { summaryMetadataText } from "@/lib/summaries/summary-model"
import type { BotCredential, ChatDestination, Summary } from "@/types"
import { PublishMetadataPanel } from "./PublishMetadataPanel"
import { SummaryNote } from "./SummaryNote"
import {
  GeneratingSkeleton,
  PendingSummaryPanel,
  SummaryCounts,
  SummaryMetaChips,
} from "./SummaryParts"
import {
  ExportButtons,
  NoteToggleButton,
  PublishControls,
  RerunButton,
  TelegramLengthHint,
} from "./SummaryToolbar"
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
  /** The rendered report; a slot because its paragraphs read the workspace. */
  markdown: React.ReactNode
  /** `ArtifactScopeLine`; a slot because it reads the workspace contexts. */
  scopeLine: (summary: Summary, className?: string) => React.ReactNode
  /** Shown with no result; a slot because it reads `useUI`. */
  emptyState: React.ReactNode
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
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10 border-b border-app-ink/10 pb-6">
          <div>
            <h3 className="text-2xl font-bold tracking-tight mb-3">
              Analysis Report
            </h3>
            <SummaryMetaChips
              timestamp={summary?.timestamp ?? Date.now()}
              model={summary?.model}
              language={summary?.language}
            />
          </div>
          <div className="flex items-center gap-1.5 bg-app-muted/20 p-1.5 rounded-xl border border-app-ink/5">
            <PublishControls
              bots={props.bots}
              destinations={props.destinations}
              onPublish={(bot, dest) => props.onPublish(bot, dest, body)}
            />
            {summary && (
              <NoteToggleButton
                note={summary.note}
                editing={props.editingNote}
                onToggle={() => props.onEditingNoteChange(!props.editingNote)}
              />
            )}
            <RerunButton running={props.running} onRerun={props.onRerun} />
            <ExportButtons body={body} />
          </div>
          <TelegramLengthHint
            length={telegramMessageLength(body, props.metadataToSend)}
          />
        </div>
        <div
          dir={props.direction.dir}
          className={`prose prose-sm md:prose-base max-w-none prose-headings:tracking-tight prose-headings:font-bold prose-p:leading-relaxed prose-p:text-app-ink/80 prose-li:text-app-ink/80 prose-li:my-1 dark:prose-invert ${props.direction.className}`}
        >
          {props.markdown}
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
            <div className="mt-12 pt-6 border-t border-app-ink/10 flex flex-col md:flex-row justify-between items-center gap-4">
              <div className="flex items-center gap-2">
                <SummaryCounts
                  postsLabel={`${summary.postCount} Posts Analyzed`}
                  summary={summary}
                />
              </div>
              {/*
               * The Summary's own window, not the workspace's. This read
               * `startDate`/`endDate` off live Scope until AW-08, so a
               * Summary generated last week described whatever window Posts
               * happened to be showing while you read it.
               */}
              {scopeLine(summary)}
            </div>
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
