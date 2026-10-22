// PROTOTYPE: History's winning list form, cards (Q3 in
// docs/history-tab-redesign-plan.md). Writes are stubbed. Never merge as is.
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
import { BarPopover } from "@/components/BarPopover"
import {
  ARTIFACT_KIND_LABELS,
  artifactDetail,
  failedAttempts,
  isPendingArtifact,
} from "@/components/history/artifact-presentation"
import { RelativeTime } from "@/components/RelativeTime"
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
import { useApplyArtifactScope } from "@/hooks/useApplyArtifactScope"
import { artifactWindowText } from "@/lib/scope/artifact-scope"
import type { ArtifactListItem } from "@/types"

export type Acts = {
  open: (a: ArtifactListItem) => void
  star: (a: ArtifactListItem) => void
  saveNote: (a: ArtifactListItem, note: string) => void
  del: (a: ArtifactListItem) => void
  autoRegenerate: (a: ArtifactListItem) => void
  autoPublish: (a: ArtifactListItem) => void
}

export type ListProps = {
  rows: ArtifactListItem[]
  acts: Acts
  /** The Posts tab's Compact grid: smaller cards, several to a row. */
  compact: boolean
  /** Day headings, which only mean something while sorted by Written. */
  days: boolean
}

const ICONS = {
  summary: FileText,
  chat: MessageSquare,
  tag: Tag,
  discovery: Compass,
} as const

/** Idea 7: a colour per kind, clear of the status reds, ambers, greens and blues. */
const KIND_COLOR = {
  summary: "text-sky-500",
  chat: "text-violet-500",
  tag: "text-orange-500",
  discovery: "text-teal-500",
} as const

const keyOf = (a: ArtifactListItem) => `${a.kind}:${a.id}`

/** Failed, Generating, Awaiting response: the states worth a badge. */
function StatusBadge({ a }: { a: ArtifactListItem }) {
  const failed = failedAttempts(a)
  const base = "rounded-full px-2 py-0.5 text-[11px] font-semibold"
  if (failed !== null)
    return (
      <span className={`${base} bg-red-500/15 text-red-700 dark:text-red-300`}>
        {failed > 1 ? `Failed ×${failed}` : "Failed"}
      </span>
    )
  if (a.kind === "summary" && a.status === "running")
    return <span className={`${base} bg-app-ink/10`}>Generating</span>
  if (isPendingArtifact(a))
    return (
      <span
        className={`${base} bg-amber-500/15 text-amber-700 dark:text-amber-300`}
      >
        Awaiting response
      </span>
    )
  return null
}

function KindLabel({ a }: { a: ArtifactListItem }) {
  const Icon = ICONS[a.kind]
  return (
    <span className="inline-flex items-center gap-1.5 text-app-ink/70">
      <Icon size={13} className={`shrink-0 ${KIND_COLOR[a.kind]}`} />
      {ARTIFACT_KIND_LABELS[a.kind]}
    </span>
  )
}

/** The note, edited in a popover anchored to its button (Q4). */
function NoteButton({
  a,
  acts,
  labelled,
}: {
  a: ArtifactListItem
  acts: Acts
  labelled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(a.note ?? "")
  const label = a.note ? "Edit note" : "Add note"
  return (
    <BarPopover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(a.note ?? "")
        setOpen(next)
      }}
      align="end"
      trigger={
        labelled ? (
          <button type="button" className={actionClass(Boolean(a.note))}>
            <StickyNote size={13} /> {a.note ? "Note" : "Add note"}
          </button>
        ) : (
          <TgIconButton
            aria-label={label}
            tooltip={label}
            className={a.note ? "text-app-ink" : undefined}
          >
            <StickyNote size={14} />
          </TgIconButton>
        )
      }
    >
      <div className="space-y-2 p-1">
        <textarea
          // biome-ignore lint/a11y/noAutofocus: the popover opens to write.
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder={`Note on this ${ARTIFACT_KIND_LABELS[a.kind]}`}
          className="w-full rounded-lg border border-app-ink/15 bg-app-muted p-2 text-xs outline-none focus:border-app-ink/40"
        />
        <div className="flex justify-end gap-2">
          <TgButton variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </TgButton>
          <TgButton
            size="sm"
            onClick={() => {
              acts.saveNote(a, draft)
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

const actionClass = (on: boolean) =>
  `inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-[12px] hover:bg-app-ink/10 ${
    on ? "text-app-ink" : "text-app-ink/50"
  }`

function ActedBy({ a }: { a: ArtifactListItem }) {
  if (!a.actedByEmail) return null
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-app-ink/60">
      <ShieldCheck size={12} className="shrink-0 opacity-60" />
      <span className="truncate">
        Last changed by {a.actedByEmail} on your behalf
      </span>
    </p>
  )
}

const headline = (a: ArtifactListItem) =>
  failedAttempts(a) !== null
    ? "Generation failed. Open it to retry, keep a Partial response or paste a response."
    : a.title || artifactDetail(a)

/** Idea 2: a title as plain text, without markdown marks or a leading emoji. */
const plainTitle = (text: string) =>
  text
    .replace(/\*\*|__|`|^#+\s*/g, "")
    .replace(/^(?:\s|\p{Extended_Pictographic}|\uFE0F)+/u, "")
    .trim()

/** Idea 3: the first three channels, then a count; the full list on hover. */
function ChannelsLine({ a }: { a: ArtifactListItem }) {
  const channels = a.scope?.channels ?? []
  if (channels.length === 0)
    return <span className="text-sm font-semibold">No channels</span>
  const rest = channels.length - 3
  return (
    <span
      title={channels.join(", ")}
      className="flex min-w-0 items-center gap-1.5 text-sm font-semibold"
    >
      <span className="truncate">{channels.slice(0, 3).join(", ")}</span>
      {rest > 0 && (
        <span className="shrink-0 rounded-full bg-app-ink/10 px-1.5 text-[11px] font-medium tabular-nums">
          +{rest.toLocaleString()}
        </span>
      )}
    </span>
  )
}

/** Idea 1: the window line with a quiet "Use this Scope" icon at its end. */
function WindowLine({ a }: { a: ArtifactListItem }) {
  const applyScope = useApplyArtifactScope()
  const text = artifactWindowText(a)
  return (
    <p className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-app-ink/55">
      <Clock size={12} className="shrink-0 opacity-60" />
      <span className="min-w-0 truncate">{text ?? "Window not recorded"}</span>
      {a.scope && text && (
        <TgIconButton
          aria-label="Use this Scope"
          tooltip="Use this Scope"
          onClick={() => a.scope && applyScope(a.scope)}
          className="size-6 shrink-0"
        >
          <Crosshair size={13} />
        </TgIconButton>
      )}
    </p>
  )
}

/** Idea 4: the Summary flags as header chips while on. */
function FlagChips({ a }: { a: ArtifactListItem }) {
  if (a.kind !== "summary") return null
  const chip =
    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
  return (
    <>
      {a.autoRegenerate && (
        <span
          className={`${chip} bg-green-500/10 text-green-700 dark:text-green-300`}
        >
          <RefreshCw size={11} /> Auto-regenerates
        </span>
      )}
      {a.autoPublish && (
        <span
          className={`${chip} bg-blue-500/10 text-blue-700 dark:text-blue-300`}
        >
          <Send size={11} /> Auto-publishes
        </span>
      )}
    </>
  )
}

/** Idea 4: the Summary flags and Delete, behind "⋯". */
function MoreMenu({ a, acts }: { a: ArtifactListItem; acts: Acts }) {
  const pending = isPendingArtifact(a)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <TgIconButton aria-label="More actions" tooltip="More actions">
          <MoreHorizontal size={14} />
        </TgIconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="text-xs">
        {a.kind === "summary" && (
          <>
            <DropdownMenuCheckboxItem
              checked={Boolean(a.autoRegenerate)}
              disabled={pending}
              onSelect={() => acts.autoRegenerate(a)}
            >
              Auto-regenerate
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={Boolean(a.autoPublish)}
              disabled={pending}
              onSelect={() => acts.autoPublish(a)}
            >
              Auto-publish
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem variant="destructive" onSelect={() => acts.del(a)}>
          <Trash2 /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Card({
  a,
  acts,
  compact,
}: {
  a: ArtifactListItem
  acts: Acts
  compact: boolean
}) {
  const failed = failedAttempts(a) !== null
  return (
    <article
      className={`flex min-w-0 flex-col gap-2 rounded-xl border bg-app-card px-4 pt-3 pb-1.5 transition-colors ${
        failed
          ? "border-red-500/30 hover:border-red-500/50"
          : "border-app-ink/10 hover:border-app-ink/20"
      }`}
    >
      <header className="flex min-w-0 flex-wrap items-center gap-2 text-[12px]">
        <KindLabel a={a} />
        <StatusBadge a={a} />
        <FlagChips a={a} />
        <span className="ml-auto shrink-0 text-app-ink/50">
          <RelativeTime timestamp={a.timestamp} />
        </span>
      </header>
      <button
        type="button"
        onClick={() => acts.open(a)}
        className="flex min-w-0 flex-col gap-1 text-left"
      >
        <ChannelsLine a={a} />
        <span
          dir="auto"
          className="line-clamp-2 text-start text-[13px] leading-relaxed text-app-ink/80"
        >
          {failed ? headline(a) : plainTitle(headline(a))}
        </span>
      </button>
      {!compact && <WindowLine a={a} />}
      {!compact && <ActedBy a={a} />}
      {a.note && !compact && (
        <p className="break-words rounded-lg bg-app-ink/5 px-3 py-2 text-[12px] text-app-ink/70">
          {a.note}
        </p>
      )}
      <footer className="mt-auto flex items-center gap-x-2 border-t border-app-ink/5 pt-1.5 text-[12px] text-app-ink/50">
        {/* The header's badge already says Failed or Awaiting response. */}
        <span className="min-w-0 truncate">
          {failed || isPendingArtifact(a) ? "" : artifactDetail(a)}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            aria-label={a.isStarred ? "Unstar" : "Star"}
            onClick={() => acts.star(a)}
            className={actionClass(Boolean(a.isStarred))}
          >
            <Star
              size={13}
              className={a.isStarred ? "fill-amber-500 text-amber-500" : ""}
            />
            {!compact && (a.isStarred ? "Starred" : "Star")}
          </button>
          <NoteButton a={a} acts={acts} labelled={!compact} />
          <MoreMenu a={a} acts={acts} />
        </span>
      </footer>
    </article>
  )
}

/** 1: Posts-style cards in one column under day headings (idea 5). */
export function CardsVariant({ rows, acts, compact, days }: ListProps) {
  // Compact is one grid with no day headings, as the Posts tab's is: most
  // days hold one or two Artifacts, so a grid per day would be a column.
  if (compact || !days)
    return (
      <div
        className={
          compact
            ? "grid grid-cols-[repeat(auto-fill,minmax(min(22rem,100%),1fr))] gap-3"
            : "grid grid-cols-1 gap-3"
        }
      >
        {rows.map((a) => (
          <Card key={keyOf(a)} a={a} acts={acts} compact={compact} />
        ))}
      </div>
    )
  return (
    <div className="space-y-5">
      {byDay(rows).map((g) => (
        <section key={g.label}>
          <h3 className="mb-2 px-1 text-[11px] font-semibold text-app-ink/50">
            {g.label} · {g.rows.length}
          </h3>
          <div className="grid grid-cols-1 gap-3">
            {g.rows.map((a) => (
              <Card key={keyOf(a)} a={a} acts={acts} compact={false} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function dayLabel(ms: number): string {
  const day = new Date(ms)
  day.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((today.getTime() - day.getTime()) / 86_400_000)
  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  return day.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: day.getFullYear() === today.getFullYear() ? undefined : "numeric",
  })
}

function byDay(rows: ArtifactListItem[]) {
  const groups: { label: string; rows: ArtifactListItem[] }[] = []
  for (const a of rows) {
    const label = dayLabel(a.timestamp ?? 0)
    const last = groups.at(-1)
    if (last?.label === label) last.rows.push(a)
    else groups.push({ label, rows: [a] })
  }
  return groups
}
