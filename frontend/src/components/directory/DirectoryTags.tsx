/**
 * Tags in the Directory (DFP-04): a Channel's badges, the picker that puts a
 * Tag on or takes it off, and the Tags menu that ticks a Tag's Channels,
 * renames it and deletes it. Props only; `DirectoryView` wires them to
 * `useTags`. A Tag is the Account's and sits on any Channel, followed or not
 * (ADR-029); `group:` names are a Setting group's: shown and ticked, never
 * typed, put on, taken off, renamed or deleted here (story 23).
 */
import { ListChecks, Pencil, Plus, Tag, Trash2, X } from "lucide-react"
import { useState } from "react"
import type { TagResponse } from "@/client"
import { BarHeading, BarPopover, BarSearch } from "@/components/BarPopover"
import { pillClass } from "@/components/PostFilterParts"
import { TgConfirmDialog } from "@/components/ui/tg-confirm-dialog"
import { isVirtualGroupTag } from "@/lib/channels/virtual-group-tags"
import { ownTags, sameTag } from "@/lib/directory/directory-tags"

const channels = (n: number) => `${n} channel${n === 1 ? "" : "s"}`

/** A Channel's Tags as badges; `onRemove` gives each but a `group:` one an x. */
export function TagBadges({
  tags,
  onRemove,
}: {
  tags: string[]
  onRemove?: (name: string) => void
}) {
  if (tags.length === 0) return null
  return (
    <span className="flex flex-wrap gap-1" data-testid="directory-tags">
      {tags.map((name) => (
        <span
          key={name}
          dir="auto"
          className="inline-flex items-center gap-0.5 rounded-full bg-violet-500/10 px-1.5 text-[10px] font-semibold text-violet-700 dark:text-violet-300"
        >
          <Tag size={9} aria-hidden />
          {name}
          {onRemove && !isVirtualGroupTag(name) && (
            <button
              type="button"
              aria-label={`Remove the Tag ${name}`}
              onClick={(e) => {
                e.stopPropagation()
                onRemove(name)
              }}
              className="rounded-full hover:bg-violet-500/20"
            >
              <X size={9} />
            </button>
          )}
        </span>
      ))}
    </span>
  )
}

/**
 * Choose one of the Account's Tags, or type a new name. A Tag in `current` is
 * ticked, and choosing it calls `onUnpick`. With `create` off only existing
 * Tags are offered, for taking one off. A `group:` Tag is never offered.
 */
export function TagPicker({
  tags,
  current = [],
  onPick,
  onUnpick,
  trigger,
  create = true,
  align = "start",
}: {
  tags: TagResponse[]
  current?: string[]
  onPick: (name: string) => void
  onUnpick?: (name: string) => void
  trigger: React.ReactElement
  create?: boolean
  align?: "start" | "end"
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const typed = query.trim()
  const own = ownTags(tags)
  const shown = own.filter((t) =>
    t.name.toLowerCase().includes(typed.toLowerCase()),
  )
  const existing = own.find((t) => sameTag(t.name, typed))
  const reserved = isVirtualGroupTag(typed)
  const choose = (name: string) => {
    setOpen(false)
    setQuery("")
    if (onUnpick && current.some((c) => sameTag(c, name))) onUnpick(name)
    else onPick(name)
  }
  return (
    <BarPopover
      align={align}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery("")
      }}
      trigger={trigger}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (existing) choose(existing.name)
          else if (create && typed && !reserved) choose(typed)
        }}
      >
        <BarSearch
          value={query}
          onChange={setQuery}
          placeholder={create ? "Find or create a Tag..." : "Find a Tag..."}
          testId="directory-tag-search"
        />
      </form>
      {reserved && (
        <p className="px-2 py-1.5 text-amber-600">
          Tags starting with "group:" belong to Setting groups
        </p>
      )}
      {create && typed && !existing && !reserved && (
        <button
          type="button"
          onClick={() => choose(typed)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-semibold hover:bg-app-ink/5"
        >
          <Plus size={12} /> Create the Tag "{typed}"
        </button>
      )}
      {shown.length === 0 && !create && (
        <p className="px-2 py-3 text-app-ink/50">No Tag matches</p>
      )}
      {shown.map((t) => (
        <label
          key={t.name}
          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-app-ink/5"
        >
          <input
            type="checkbox"
            className="accent-violet-600"
            checked={current.some((c) => sameTag(c, t.name))}
            onChange={() => choose(t.name)}
          />
          <span dir="auto" className="flex-1 truncate font-semibold">
            {t.name}
          </span>
          <span className="tabular-nums text-app-ink/50">{t.channels}</span>
        </label>
      ))}
    </BarPopover>
  )
}

/**
 * The Account's Tags: tick exactly a Tag's Channels, rename it (onto an
 * existing name merges the two) or delete it after saying how many Channels
 * it is on. A `group:` Tag ticks but is a Setting group's to rename or delete.
 */
export function TagsMenu({
  tags,
  onTick,
  onRename,
  onDelete,
}: {
  tags: TagResponse[]
  onTick: (name: string) => void
  onRename: (name: string, to: string) => void
  onDelete: (name: string) => void
}) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [deleting, setDeleting] = useState<TagResponse | null>(null)
  const icon = "rounded-md p-1 text-app-ink/50 hover:bg-app-ink/10"
  return (
    <>
      <BarPopover
        align="end"
        width="w-80"
        onOpenChange={(open) => open || setRenaming(null)}
        trigger={
          <button
            type="button"
            data-testid="directory-tags-menu"
            className={pillClass(false)}
          >
            <Tag size={12} /> Tags
            {tags.length > 0 && (
              <span className="rounded-full bg-app-ink/15 px-1.5 text-[10px] tabular-nums">
                {tags.length}
              </span>
            )}
          </button>
        }
      >
        <BarHeading>
          Your Tags, on any channel, followed or not. Renaming onto an existing
          Tag merges the two
        </BarHeading>
        {tags.length === 0 && (
          <p className="px-2 py-3 text-app-ink/50">
            No Tags yet: tick channels and tag them from the bar
          </p>
        )}
        {tags.map((t) => (
          <div
            key={t.name}
            className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-app-ink/5"
          >
            {renaming === t.name ? (
              <form
                className="flex-1"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (draft.trim() && draft.trim() !== t.name)
                    onRename(t.name, draft.trim())
                  setRenaming(null)
                }}
              >
                <input
                  // biome-ignore lint/a11y/noAutofocus: opened to type the new name.
                  autoFocus
                  aria-label={`New name for ${t.name}`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="h-7 w-full rounded-md border border-app-ink/20 bg-app-muted px-2"
                />
              </form>
            ) : (
              <span dir="auto" className="flex-1 truncate font-semibold">
                {t.name}
              </span>
            )}
            <span className="px-1 tabular-nums text-app-ink/50">
              {t.channels}
            </span>
            <button
              type="button"
              title="Tick exactly its channels"
              aria-label={`Tick the channels in ${t.name}`}
              onClick={() => onTick(t.name)}
              className={icon}
            >
              <ListChecks size={12} />
            </button>
            {!isVirtualGroupTag(t.name) && (
              <>
                <button
                  type="button"
                  aria-label={`Rename ${t.name}`}
                  onClick={() => {
                    setRenaming(t.name)
                    setDraft(t.name)
                  }}
                  className={icon}
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${t.name}`}
                  onClick={() => setDeleting(t)}
                  className={icon}
                >
                  <Trash2 size={12} />
                </button>
              </>
            )}
          </div>
        ))}
      </BarPopover>
      <TgConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => open || setDeleting(null)}
        title="Delete the Tag?"
        description={
          deleting &&
          `"${deleting.name}" is on ${channels(deleting.channels)}; deleting it takes it off every one.`
        }
        confirmLabel="Delete"
        variant="destructive"
        confirmTestId="directory-tag-delete-confirm"
        onConfirm={() => {
          if (deleting) onDelete(deleting.name)
          setDeleting(null)
        }}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}
