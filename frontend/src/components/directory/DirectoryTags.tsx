/**
 * Tags in the Directory (DFP-04): a Channel's badges and the picker that puts
 * a Tag on or takes it off. Props only; `DirectoryView` wires them to
 * `useTags`, and the Tags dropdown is `TagsDropdown` (TGU-03). A Tag is the
 * Account's and sits on any Channel, followed or not (ADR-029); `group:`
 * names are a Setting group's: shown, never typed, put on or taken off here
 * (story 23).
 */
import { Plus, Tag, X } from "lucide-react"
import { useState } from "react"
import type { TagResponse } from "@/client"
import { BarPopover, BarSearch } from "@/components/BarPopover"
import { pillClass } from "@/components/PostFilterParts"
import { isVirtualGroupTag } from "@/lib/channels/virtual-group-tags"
import { ownTags, sameTag } from "@/lib/directory/directory-tags"

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
