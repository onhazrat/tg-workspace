import {
  Compass,
  FileText,
  MessageSquare,
  RefreshCw,
  Send,
  Star,
  StickyNote,
  Tag,
  Trash2,
} from "lucide-react"
import type React from "react"
import { TgMetaChip } from "@/components/ui/tg-chips"
import { TgIconButton } from "@/components/ui/tg-icon-button"
import type { ArtifactListItem } from "@/types"

import { RelativeTime } from "../RelativeTime"
import {
  ARTIFACT_KIND_LABELS,
  artifactDetail,
  isPendingArtifact,
} from "./artifact-presentation"

const ICONS = {
  summary: FileText,
  chat: MessageSquare,
  tag: Tag,
  discovery: Compass,
} as const

interface ArtifactCardProps {
  artifact: ArtifactListItem
  onOpen: (artifact: ArtifactListItem) => void
  onToggleStar: (artifact: ArtifactListItem) => void
  onEditNote: (artifact: ArtifactListItem) => void
  onDelete: (artifact: ArtifactListItem) => void
  /** Summaries only — the two scheduled-regeneration flags. */
  onToggleAutoRegenerate: (artifact: ArtifactListItem) => void
  onToggleAutoPublish: (artifact: ArtifactListItem) => void
}

/**
 * One row of the unified History list.
 *
 * Deliberately the same card for all four kinds. History's job is "what have I
 * made, and when" — the differences between a summary and a tag run belong on
 * the tab that renders the artifact, not in four subtly different cards that
 * have to be kept in visual step with each other.
 */
export const ArtifactCard: React.FC<ArtifactCardProps> = ({
  artifact,
  onOpen,
  onToggleStar,
  onEditNote,
  onDelete,
  onToggleAutoRegenerate,
  onToggleAutoPublish,
}) => {
  const Icon = ICONS[artifact.kind]
  const pending = isPendingArtifact(artifact)
  /*
   * Auto-regenerate and auto-publish are summary-only, and History is the only
   * place they can be toggled — the first rewrite of this card dropped them,
   * which made scheduled regeneration unreachable from the UI entirely.
   */
  const summary = artifact.kind === "summary" ? artifact : null

  /*
   * The `min-w-0`s below make the card safe to drop into any flex or grid
   * parent; the one that actually fixed History is on the grid item in
   * `HistoryView`, and the reasoning lives there. Either way `truncate` on the
   * channel line only ellipsizes once something upstream clamps the width.
   */
  return (
    <div
      data-testid="artifact-card"
      data-artifact-kind={artifact.kind}
      data-artifact-id={artifact.id}
      className={`group relative flex min-w-0 flex-col gap-3 rounded-xl border p-5 shadow-sm transition-all hover:shadow-md ${
        pending
          ? "border-amber-500/30 bg-amber-500/[0.03] hover:border-amber-500/50"
          : "border-app-ink/10 hover:border-app-ink/20"
      }`}
    >
      <button
        type="button"
        onClick={() => onOpen(artifact)}
        className="flex min-w-0 flex-col gap-1.5 text-left"
      >
        <div className="flex items-center gap-2">
          <Icon size={13} className="shrink-0 opacity-50" />
          <TgMetaChip>{ARTIFACT_KIND_LABELS[artifact.kind]}</TgMetaChip>
          {pending && (
            <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-200">
              Awaiting response
            </span>
          )}
        </div>
        <h4 className="truncate text-sm font-bold uppercase tracking-tight">
          {artifact.channels?.length
            ? artifact.channels.join(", ")
            : "No channels"}
        </h4>
        <p className="line-clamp-2 text-[12px] leading-relaxed text-app-ink/80">
          {artifact.title || artifactDetail(artifact)}
        </p>
      </button>

      <div className="flex min-w-0 items-center justify-between gap-3 text-[11px] font-mono text-app-ink/60">
        <span className="truncate">{artifactDetail(artifact)}</span>
        <RelativeTime timestamp={artifact.timestamp} />
      </div>

      {artifact.note && (
        <p className="break-words rounded-md border border-app-ink/10 bg-app-muted/30 px-3 py-2 text-[11px] italic text-app-ink/70">
          {artifact.note}
        </p>
      )}

      <div className="absolute right-3 top-3 flex items-center gap-1 rounded-lg border border-app-ink/5 bg-app-card/80 p-1 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <TgIconButton
          aria-label={artifact.isStarred ? "Unstar item" : "Star item"}
          tooltip={artifact.isStarred ? "Unstar item" : "Star item"}
          data-active={artifact.isStarred || undefined}
          onClick={() => onToggleStar(artifact)}
          className={
            artifact.isStarred ? "bg-amber-500/10 text-amber-500" : undefined
          }
        >
          <Star
            size={14}
            className={artifact.isStarred ? "fill-amber-500" : ""}
          />
        </TgIconButton>
        <TgIconButton
          aria-label={artifact.note ? "Edit note" : "Add note"}
          tooltip={artifact.note ? "Edit note" : "Add note"}
          data-active={artifact.note ? true : undefined}
          onClick={() => onEditNote(artifact)}
        >
          <StickyNote size={14} />
        </TgIconButton>
        {summary && (
          <>
            <TgIconButton
              aria-label={
                summary.autoRegenerate
                  ? "Disable auto-regenerate"
                  : "Enable auto-regenerate"
              }
              tooltip={
                summary.autoRegenerate
                  ? "Disable auto-regenerate"
                  : "Enable auto-regenerate"
              }
              data-active={summary.autoRegenerate || undefined}
              disabled={pending}
              onClick={() => onToggleAutoRegenerate(artifact)}
              className={
                summary.autoRegenerate
                  ? "bg-green-500/10 text-green-600"
                  : undefined
              }
            >
              <RefreshCw size={14} />
            </TgIconButton>
            <TgIconButton
              aria-label={
                summary.autoPublish
                  ? "Disable auto-publish"
                  : "Enable auto-publish"
              }
              tooltip={
                summary.autoPublish
                  ? "Disable auto-publish"
                  : "Enable auto-publish"
              }
              data-active={summary.autoPublish || undefined}
              disabled={pending}
              onClick={() => onToggleAutoPublish(artifact)}
              className={
                summary.autoPublish ? "bg-blue-500/10 text-blue-600" : undefined
              }
            >
              <Send size={14} />
            </TgIconButton>
          </>
        )}
        <TgIconButton
          aria-label="Delete item"
          tooltip="Delete item"
          onClick={() => onDelete(artifact)}
        >
          <Trash2 size={14} />
        </TgIconButton>
      </div>
    </div>
  )
}
