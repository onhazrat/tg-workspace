/**
 * The pieces a History card is assembled from, each props only, so the card
 * renders without the workspace contexts; `HistoryView` hands in the writes
 * and "Use this Scope".
 */
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock,
  Compass,
  Crosshair,
  FileText,
  MessageSquare,
  MoreHorizontal,
  RefreshCw,
  Search,
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
  artifactKey,
  channelsMatchingFirst,
  failedAttempts,
  isPendingArtifact,
} from "./artifact-presentation"
import { publishPairs, publishTargetOf } from "./history-view-model"

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
  /** Summaries only: the Publish target, and what it can be chosen from. */
  publishTarget: {
    bots: readonly BotCredential[]
    destinations: readonly ChatDestination[]
    /** The card whose target popover is open, as `kind:id`, or `null`. */
    openFor: string | null
    setOpenFor: (key: string | null) => void
    set: (artifact: ArtifactListItem, botId: string, chatId: string) => void
    /** Settings › Publishing, where bots and Destinations are added. */
    openSettings: () => void
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

/** Auto-regenerate, while it is on; Auto-publish is `PublishChip`. */
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
    </>
  )
}

/** Focus the search only where a keyboard is likely: on a phone it hides the list. */
const finePointer = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: fine)").matches

/**
 * Where Auto-publish sends, in the header while it is on: the Destination, or
 * an amber "choose where" until a bot and a Destination are both saved. A
 * half that names a deleted bot or Destination counts as missing, because the
 * scheduler sends nothing for it either. One pick in the popover saves both.
 */
export function PublishChip({
  artifact,
  target,
}: {
  artifact: ArtifactListItem
  target: ArtifactActions["publishTarget"]
}) {
  const [query, setQuery] = useState("")
  if (artifact.kind !== "summary" || !artifact.autoPublish) return null
  const key = artifactKey(artifact)
  const saved = publishTargetOf(artifact, target.bots, target.destinations)
  const open = target.openFor === key
  const pairs = open
    ? publishPairs(target.bots, target.destinations, query)
    : []
  const missing = [
    target.bots.length === 0 && "a bot",
    target.destinations.length === 0 && "a Destination",
  ]
    .filter(Boolean)
    .join(" and ")
  return (
    <BarPopover
      open={open}
      onOpenChange={(open) => {
        if (open) setQuery("")
        target.setOpenFor(open ? key : null)
      }}
      width="w-80"
      trigger={
        <button
          type="button"
          title={saved ? `Sent by ${saved.bot.name}` : undefined}
          className={`${CHIP} max-w-64 ${
            saved
              ? "bg-blue-500/10 text-blue-700 hover:bg-blue-500/20 dark:text-blue-300"
              : "bg-amber-500/15 text-amber-800 ring-1 ring-amber-500/40 hover:bg-amber-500/25 dark:text-amber-300"
          }`}
        >
          {saved ? <Send size={11} /> : <AlertTriangle size={11} />}
          <span className="truncate">
            {saved
              ? `Auto-publishes to ${saved.destination.name}`
              : "Auto-publish: choose where"}
          </span>
          <ChevronDown size={11} className="shrink-0 opacity-60" />
        </button>
      }
    >
      {missing ? (
        <p className="p-1 text-app-ink/60">
          Auto-publish needs {missing}. Add{" "}
          {missing.includes(" and ") ? "them" : "one"} in{" "}
          <button
            type="button"
            onClick={target.openSettings}
            className="font-semibold underline"
          >
            Settings › Publishing
          </button>
          .
        </p>
      ) : (
        <>
          <label className="mb-2 flex items-center gap-1.5 rounded-md border border-app-ink/15 bg-app-muted px-2 py-1 focus-within:border-app-ink/40">
            <Search size={12} className="opacity-50" />
            <input
              // biome-ignore lint/a11y/noAutofocus: the popover opens to search.
              autoFocus={finePointer()}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Destinations and bots"
              aria-label="Search Destinations and bots"
              className="min-w-0 flex-1 bg-transparent outline-none"
            />
          </label>
          {pairs.length === 0 && (
            <p className="px-2 py-1 text-app-ink/50">Nothing matches.</p>
          )}
          {pairs.map(({ bot, destination }) => {
            const on =
              bot.id === saved?.bot.id &&
              destination.id === saved?.destination.id
            return (
              <button
                key={`${destination.id}:${bot.id}`}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  target.set(artifact, bot.id, destination.id)
                  target.setOpenFor(null)
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-app-ink/10 ${
                  on ? "bg-app-ink/5 font-semibold" : ""
                }`}
              >
                <Check
                  size={12}
                  className={`shrink-0 ${on ? "" : "invisible"}`}
                />
                <span className="min-w-0">
                  <span dir="auto" className="block truncate">
                    {destination.name}
                  </span>
                  <span className="block truncate font-mono text-[10px] font-normal text-app-ink/45">
                    via {bot.name}
                  </span>
                </span>
              </button>
            )
          })}
        </>
      )}
    </BarPopover>
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
