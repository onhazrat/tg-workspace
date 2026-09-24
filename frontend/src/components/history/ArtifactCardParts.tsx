import {
  Compass,
  FileText,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldCheck,
  Star,
  StickyNote,
  Tag,
  Trash2,
} from "lucide-react"
import type React from "react"
import { TgMetaChip } from "@/components/ui/tg-chips"
import { TgIconButton } from "@/components/ui/tg-icon-button"
import type { ArtifactListItem } from "@/types"
import {
  ARTIFACT_KIND_LABELS,
  artifactChannelsLine,
  artifactDetail,
} from "./artifact-presentation"

const ICONS = {
  summary: FileText,
  chat: MessageSquare,
  tag: Tag,
  discovery: Compass,
} as const

type Handler = (artifact: ArtifactListItem) => void

/** The clickable top of the card: kind, channels and title. */
export const ArtifactCardHeading: React.FC<{
  artifact: ArtifactListItem
  pending: boolean
  onOpen: Handler
}> = ({ artifact, pending, onOpen }) => {
  const Icon = ICONS[artifact.kind]
  return (
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
        {artifactChannelsLine(artifact)}
      </h4>
      <p className="line-clamp-2 text-[12px] leading-relaxed text-app-ink/80">
        {artifact.title || artifactDetail(artifact)}
      </p>
    </button>
  )
}

/**
 * Who last changed the row on the owner's behalf, and the owner's own note.
 *
 * The acted-by line is on the card rather than only on the detail view
 * (ticket 27), because "did I make this?" is asked while scanning the list,
 * and an artifact somebody else wrote on your behalf is exactly the one you
 * would not remember making. Null for almost every row, so it renders
 * conditionally instead of as a line of dead chrome on every card.
 */
export const ArtifactCardNotes: React.FC<{ artifact: ArtifactListItem }> = ({
  artifact,
}) => (
  <>
    {artifact.actedByEmail && (
      <p
        data-testid="artifact-acted-by"
        className="flex min-w-0 items-center gap-1.5 text-[11px] text-app-ink/60"
      >
        <ShieldCheck size={12} className="shrink-0 opacity-60" />
        <span className="truncate">
          Last changed by {artifact.actedByEmail} on your behalf
        </span>
      </p>
    )}
    {artifact.note && (
      <p className="break-words rounded-md border border-app-ink/10 bg-app-muted/30 px-3 py-2 text-[11px] italic text-app-ink/70">
        {artifact.note}
      </p>
    )}
  </>
)

/** An icon button whose label names what a click does next. */
const ToggleAction: React.FC<{
  active: boolean
  /** The label while off, then while on. */
  labels: readonly [string, string]
  activeClassName?: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}> = ({ active, labels, activeClassName, disabled, onClick, children }) => {
  const label = active ? labels[1] : labels[0]
  return (
    <TgIconButton
      aria-label={label}
      tooltip={label}
      data-active={active || undefined}
      disabled={disabled}
      onClick={onClick}
      className={active ? activeClassName : undefined}
    >
      {children}
    </TgIconButton>
  )
}

/**
 * The hover bar. Auto-regenerate and auto-publish are summary-only, and History
 * is the only place they can be toggled — the first rewrite of this card
 * dropped them, which made scheduled regeneration unreachable from the UI.
 */
export const ArtifactCardActions: React.FC<{
  artifact: ArtifactListItem
  pending: boolean
  onToggleStar: Handler
  onEditNote: Handler
  onDelete: Handler
  onToggleAutoRegenerate: Handler
  onToggleAutoPublish: Handler
}> = ({
  artifact,
  pending,
  onToggleStar,
  onEditNote,
  onDelete,
  onToggleAutoRegenerate,
  onToggleAutoPublish,
}) => (
  <div className="absolute right-3 top-3 flex items-center gap-1 rounded-lg border border-app-ink/5 bg-app-card/80 p-1 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
    <ToggleAction
      active={Boolean(artifact.isStarred)}
      labels={["Star item", "Unstar item"]}
      activeClassName="bg-amber-500/10 text-amber-500"
      onClick={() => onToggleStar(artifact)}
    >
      <Star size={14} className={artifact.isStarred ? "fill-amber-500" : ""} />
    </ToggleAction>
    <ToggleAction
      active={Boolean(artifact.note)}
      labels={["Add note", "Edit note"]}
      onClick={() => onEditNote(artifact)}
    >
      <StickyNote size={14} />
    </ToggleAction>
    {artifact.kind === "summary" && (
      <>
        <ToggleAction
          active={Boolean(artifact.autoRegenerate)}
          labels={["Enable auto-regenerate", "Disable auto-regenerate"]}
          activeClassName="bg-green-500/10 text-green-600"
          disabled={pending}
          onClick={() => onToggleAutoRegenerate(artifact)}
        >
          <RefreshCw size={14} />
        </ToggleAction>
        <ToggleAction
          active={Boolean(artifact.autoPublish)}
          labels={["Enable auto-publish", "Disable auto-publish"]}
          activeClassName="bg-blue-500/10 text-blue-600"
          disabled={pending}
          onClick={() => onToggleAutoPublish(artifact)}
        >
          <Send size={14} />
        </ToggleAction>
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
)
