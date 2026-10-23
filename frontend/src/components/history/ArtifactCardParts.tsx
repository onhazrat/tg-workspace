/**
 * The pieces a History card is assembled from, each props only, so the card
 * renders without the workspace contexts; `HistoryView` hands in the writes
 * and "Use this Scope".
 */
import {
  Clock,
  Compass,
  Crosshair,
  FileText,
  MessageSquare,
  MoreHorizontal,
  RefreshCw,
  Send,
  ShieldCheck,
  Star,
  StickyNote,
  Tag,
  Trash2,
} from "lucide-react"
import { useState } from "react"
import type { FrozenScope } from "@/client"
import { BarPopover } from "@/components/BarPopover"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TgButton } from "@/components/ui/tg-button"
import { TgIconButton } from "@/components/ui/tg-icon-button"
import { shortcut, withKey } from "@/lib/keyboard/key-list"
import { useKeyboardMode, useKeyTitle } from "@/lib/keyboard/mode"
import { artifactWindowText } from "@/lib/scope/artifact-scope"
import { highlightText } from "@/lib/utils"
import type { ArtifactListItem, BotCredential, ChatDestination } from "@/types"
import {
  ARTIFACT_KIND_COLORS,
  ARTIFACT_KIND_LABELS,
  channelsMatchingFirst,
  failedAttempts,
  isPendingArtifact,
} from "./artifact-presentation"

const ICONS = {
  summary: FileText,
  chat: MessageSquare,
  tag: Tag,
  discovery: Compass,
} as const

type Handler = (artifact: ArtifactListItem) => void

/** What a card's controls do; `HistoryView` supplies every one. */
export type ArtifactActions = {
  open: Handler
  star: Handler
  /** `null` deletes the note. */
  saveNote: (artifact: ArtifactListItem, note: string | null) => void
  remove: Handler
  /** Summaries only: the two scheduled-regeneration flags. */
  autoRegenerate: Handler
  autoPublish: Handler
  /** Summaries only: where Auto-publish sends, and what it can choose from. */
  publishTarget: {
    bots: readonly BotCredential[]
    destinations: readonly ChatDestination[]
    set: (artifact: ArtifactListItem, botId: string, chatId: string) => void
  }
  useScope: (scope: FrozenScope) => void
}

/** The kind, its icon in the kind's own colour. */
export function KindLabel({ artifact }: { artifact: ArtifactListItem }) {
  const Icon = ICONS[artifact.kind]
  return (
    <span className="inline-flex items-center gap-1.5 text-app-ink/70">
      <Icon
        size={13}
        data-testid="artifact-kind-icon"
        className={`shrink-0 ${ARTIFACT_KIND_COLORS[artifact.kind]}`}
      />
      {ARTIFACT_KIND_LABELS[artifact.kind]}
    </span>
  )
}

const BADGE = "rounded-full px-2 py-0.5 text-[11px] font-semibold"

/** Failed, Generating or Awaiting response: the states worth a badge. */
export function StatusBadge({ artifact }: { artifact: ArtifactListItem }) {
  const failed = failedAttempts(artifact)
  if (failed !== null)
    return (
      <span className={`${BADGE} bg-red-500/15 text-red-700 dark:text-red-300`}>
        {failed > 1 ? `Failed ×${failed}` : "Failed"}
      </span>
    )
  if (artifact.kind === "summary" && artifact.status === "running")
    return <span className={`${BADGE} bg-app-ink/10`}>Generating</span>
  if (isPendingArtifact(artifact))
    return (
      <span
        className={`${BADGE} bg-amber-500/15 text-amber-700 dark:text-amber-300`}
      >
        Awaiting response
      </span>
    )
  return null
}

const CHIP =
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"

/** A Summary's schedule flags, while they are on. */
export function FlagChips({ artifact }: { artifact: ArtifactListItem }) {
  if (artifact.kind !== "summary") return null
  return (
    <>
      {artifact.autoRegenerate && (
        <span
          className={`${CHIP} bg-green-500/10 text-green-700 dark:text-green-300`}
        >
          <RefreshCw size={11} /> Auto-regenerates
        </span>
      )}
      {artifact.autoPublish && (
        <span
          className={`${CHIP} bg-blue-500/10 text-blue-700 dark:text-blue-300`}
        >
          <Send size={11} /> Auto-publishes
        </span>
      )}
    </>
  )
}

const TARGET_SELECT =
  "min-w-0 max-w-40 truncate rounded-md border border-app-ink/15 bg-app-card px-1.5 py-0.5 text-[11px] outline-none focus:border-app-ink/40"

/**
 * Where Auto-publish sends, while it is on. Shown in the Compact grid too:
 * without both a bot and a chat the scheduler sends nothing, and History
 * once saved the flag alone for two months with no sign anything was missing.
 */
export function PublishTargetLine({
  artifact,
  target,
}: {
  artifact: ArtifactListItem
  target: ArtifactActions["publishTarget"]
}) {
  if (artifact.kind !== "summary" || !artifact.autoPublish) return null
  const bot = artifact.publishBotId ?? ""
  const chat = artifact.publishChatId ?? ""
  return (
    <div
      data-testid="publish-target"
      className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-app-ink/60"
    >
      <Send size={12} className="shrink-0 opacity-60" />
      Publishes with
      <select
        aria-label="Auto-publish bot"
        value={bot}
        onChange={(e) => target.set(artifact, e.target.value, chat)}
        className={TARGET_SELECT}
      >
        <option value="">Choose a bot</option>
        {target.bots.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      to
      <select
        aria-label="Auto-publish chat"
        value={chat}
        onChange={(e) => target.set(artifact, bot, e.target.value)}
        className={TARGET_SELECT}
      >
        <option value="">Choose a chat</option>
        {target.destinations.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      {(!bot || !chat) && (
        <span className="text-amber-700 dark:text-amber-300">
          Nothing is sent until both are chosen.
        </span>
      )}
    </div>
  )
}

/** How many channels the line names before the "+N". */
const SHOWN_CHANNELS = 3

/**
 * The first three channels and a count of the rest, the whole list on hover,
 * the search's matches first, so a Scope of 1,700 channels fits the card.
 */
export function ChannelsLine({
  channels,
  search,
}: {
  channels: readonly string[]
  search: string
}) {
  if (channels.length === 0)
    return <span className="text-sm font-semibold">No channels</span>
  const ordered = channelsMatchingFirst(channels, search)
  const rest = ordered.length - SHOWN_CHANNELS
  return (
    <span
      data-testid="artifact-channels"
      dir="auto"
      title={channels.join(", ")}
      className="flex min-w-0 items-center gap-1.5 text-sm font-semibold"
    >
      <span className="truncate">
        {ordered.slice(0, SHOWN_CHANNELS).map((channel, i) => (
          <span key={channel}>
            {i > 0 && ", "}
            {highlightText(channel, search.trim())}
          </span>
        ))}
      </span>
      {rest > 0 && (
        <span className="shrink-0 rounded-full bg-app-ink/10 px-1.5 text-[11px] font-medium tabular-nums">
          +{rest.toLocaleString()}
        </span>
      )}
    </span>
  )
}

/**
 * The frozen Analysis window on one line, ending in a quiet "Use this Scope"
 * (AW-08). A row with no Scope says so and has nothing to restore.
 */
export function WindowLine({
  artifact,
  onUseScope,
}: {
  artifact: ArtifactListItem
  onUseScope: (scope: FrozenScope) => void
}) {
  const text = artifactWindowText(artifact)
  const scope = artifact.scope
  return (
    <p
      data-testid="artifact-scope-line"
      className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-app-ink/55"
    >
      <Clock size={12} className="shrink-0 opacity-60" />
      <span className="min-w-0 truncate">
        {text ?? "Analysis window: not recorded"}
      </span>
      {scope && text && (
        <TgIconButton
          aria-label="Use this Scope"
          tooltip="Use this Scope"
          data-testid="use-this-scope"
          onClick={() => onUseScope(scope)}
          className="size-6 shrink-0"
        >
          <Crosshair size={13} />
        </TgIconButton>
      )}
    </p>
  )
}

/**
 * Who last changed the row on the owner's behalf (ticket 27): on the card,
 * because an artifact somebody else wrote is the one you would not remember
 * making.
 */
export function ActedBy({ artifact }: { artifact: ArtifactListItem }) {
  if (!artifact.actedByEmail) return null
  return (
    <p
      data-testid="artifact-acted-by"
      className="flex min-w-0 items-center gap-1.5 text-[11px] text-app-ink/60"
    >
      <ShieldCheck size={12} className="shrink-0 opacity-60" />
      <span className="truncate">
        Last changed by {artifact.actedByEmail} on your behalf
      </span>
    </p>
  )
}

const actionClass = (on: boolean) =>
  `inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-[12px] hover:bg-app-ink/10 ${
    on ? "text-app-ink" : "text-app-ink/50"
  }`

/** The note, edited in a popover beside its button rather than under the list. */
export function NoteButton({
  artifact,
  compact,
  onSave,
}: {
  artifact: ArtifactListItem
  compact: boolean
  onSave: (note: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(artifact.note ?? "")
  const label = artifact.note ? "Edit note" : "Add note"
  const keyboard = useKeyboardMode()
  return (
    <BarPopover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(artifact.note ?? "")
        setOpen(next)
      }}
      align="end"
      trigger={
        <button
          type="button"
          aria-label={label}
          title={withKey(label, "note", keyboard)}
          {...shortcut("note")}
          className={actionClass(Boolean(artifact.note))}
        >
          <StickyNote size={13} />
          {!compact && (artifact.note ? "Note" : "Add note")}
        </button>
      }
    >
      <div className="space-y-2 p-1">
        <textarea
          // biome-ignore lint/a11y/noAutofocus: the popover opens to write.
          autoFocus
          dir="auto"
          aria-label={`Note on ${ARTIFACT_KIND_LABELS[artifact.kind]}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder={`Note on this ${ARTIFACT_KIND_LABELS[artifact.kind]}`}
          className="w-full rounded-lg border border-app-ink/15 bg-app-muted p-2 text-xs outline-none focus:border-app-ink/40"
        />
        <div className="flex justify-end gap-2">
          <TgButton variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </TgButton>
          <TgButton
            size="sm"
            onClick={() => {
              onSave(draft.trim() || null)
              setOpen(false)
            }}
          >
            Save note
          </TgButton>
        </div>
      </div>
    </BarPopover>
  )
}

/** The Summary flags and Delete: the rare and the dangerous, one step away. */
export function MoreMenu({
  artifact,
  actions,
}: {
  artifact: ArtifactListItem
  actions: ArtifactActions
}) {
  const pending = isPendingArtifact(artifact)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <TgIconButton aria-label="More actions" tooltip="More actions">
          <MoreHorizontal size={14} />
        </TgIconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="text-xs">
        {artifact.kind === "summary" && (
          <>
            <DropdownMenuCheckboxItem
              checked={Boolean(artifact.autoRegenerate)}
              disabled={pending}
              onSelect={() => actions.autoRegenerate(artifact)}
            >
              Auto-regenerate
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={Boolean(artifact.autoPublish)}
              disabled={pending}
              onSelect={() => actions.autoPublish(artifact)}
            >
              Auto-publish
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => actions.remove(artifact)}
        >
          <Trash2 /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Star, Note and "⋯", always visible so a phone can reach them. */
export function CardActions({
  artifact,
  compact,
  actions,
}: {
  artifact: ArtifactListItem
  compact: boolean
  actions: ArtifactActions
}) {
  const starred = Boolean(artifact.isStarred)
  const starLabel = starred ? "Unstar item" : "Star item"
  const starTitle = useKeyTitle(starLabel, "star")
  return (
    <span className="ml-auto flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        aria-label={starLabel}
        title={starTitle}
        {...shortcut("star")}
        // History's star toasts its own outcome with Undo.
        data-says
        aria-pressed={starred}
        onClick={() => actions.star(artifact)}
        className={actionClass(starred)}
      >
        <Star
          size={13}
          className={starred ? "fill-amber-500 text-amber-500" : ""}
        />
        {!compact && (starred ? "Starred" : "Star")}
      </button>
      <NoteButton
        artifact={artifact}
        compact={compact}
        onSave={(note) => actions.saveNote(artifact, note)}
      />
      <MoreMenu artifact={artifact} actions={actions} />
    </span>
  )
}
