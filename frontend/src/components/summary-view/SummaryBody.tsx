import type React from "react"
import type { ScopedPostRef } from "@/client"
import { scopeChannels } from "@/lib/scope/artifact-scope"
import type { SummaryTextSize } from "@/lib/settings/schema"
import type { CitedPost } from "@/lib/summaries/cited-posts"
import type { Summary } from "@/types"
import { CoverageWall } from "./CoverageWall"
import { PhotoStrip } from "./PhotoStrip"
import {
  FoldableSections,
  PROSE_SIZE,
  ReadingControls,
} from "./ReadingControls"
import type { CitationWorkspace } from "./SummaryCitation"
import { type ReaderZone, SummaryHeader } from "./SummaryHeader"
import { SummaryNote } from "./SummaryNote"
import { GeneratingSkeleton, PendingSummaryPanel } from "./SummaryParts"

export interface SummaryBodyProps {
  summary: Summary | null | undefined
  promptText: string | undefined
  body: string | null
  isPending: boolean
  summarizing: boolean
  running: boolean
  direction: { dir: string; className: string }
  onRerun: () => void
  onPaste: () => void
  editingNote: boolean
  onEditingNoteChange: (editing: boolean) => void
  onSaveNote: (note: string) => Promise<void>
  onDeleteNote: () => Promise<void>
  /** The publish panel (SUMTAB-09); a slot because it reads the server's plan. */
  publishPanel: (summary: Summary) => React.ReactNode
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
  /**
   * The saved Summary's Cited Posts in first-Citation order (`useCitedPosts`),
   * for the photo strip and the coverage wall, with the frozen Scope's Post
   * refs (null when none were recorded); absent while nothing is saved.
   */
  cited?: {
    posts: CitedPost[]
    loading: boolean
    covered?: ScopedPostRef[] | null
  }
  /** The workspace's Channels, for the coverage wall's avatars and cards. */
  workspace: CitationWorkspace
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
        {summary && props.cited && (
          <PhotoStrip
            cited={props.cited.posts}
            loading={props.cited.loading}
            dir={props.direction.dir}
          />
        )}
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
        {summary &&
          props.cited &&
          (props.cited.loading ? (
            <p className="mt-10 text-xs text-app-ink/50">
              Loading the coverage…
            </p>
          ) : (
            <CoverageWall
              scopeChannels={scopeChannels(summary)}
              cited={props.cited.posts}
              covered={props.cited.covered}
              workspace={props.workspace}
            />
          ))}

        {summary && (
          <>
            <SummaryNote
              note={summary.note}
              editing={props.editingNote}
              onEditingChange={props.onEditingNoteChange}
              onSave={props.onSaveNote}
              onDelete={props.onDeleteNote}
            />
            {/*
             * The Summary's own window, not the workspace's (AW-08), kept
             * here for its "Use this Scope" action; the counts are in the
             * header now.
             */}
            {scopeLine(summary, "mt-12 pt-6 border-t border-app-ink/10")}
            {props.publishPanel(summary)}
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
