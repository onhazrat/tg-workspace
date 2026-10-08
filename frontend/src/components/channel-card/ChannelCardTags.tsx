import { X } from "lucide-react"
import { Popover } from "radix-ui"
import type React from "react"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  cardTagSuggestions,
  matchCardTags,
} from "@/lib/channels/card-tag-suggestions"
import { shortcut } from "@/lib/channels/card-zoom"
import {
  addManualTag,
  normalizeChannelTags,
  removeTagsByName,
} from "@/lib/channels/channel-tag-model"
import { isVirtualGroupTag } from "@/lib/channels/virtual-group-tags"
import type { Channel } from "@/types"

type Tags = NonNullable<Channel["tags"]>

/**
 * The tag list as the card shows it, ahead of the server, and its saves sent
 * one at a time: each waits for the one before it, then sends the list as it
 * stands. Two quick adds therefore both arrive, in order, instead of racing
 * each other with lists that each lack the other's tag.
 */
function useSerialTagSaves(
  tags: Channel["tags"],
  onSave: (tags: Tags) => Promise<void> | void,
) {
  const [local, setLocal] = useState<Tags>(tags ?? [])
  const latest = useRef(local)
  const fromServer = useRef(tags ?? [])
  const queue = useRef(Promise.resolve())
  const pending = useRef(0)

  useEffect(() => {
    fromServer.current = tags ?? []
    // While saves are queued the prop lags behind the field; the last save
    // brings it level again.
    if (pending.current > 0) return
    latest.current = tags ?? []
    setLocal(tags ?? [])
  }, [tags])

  const save = (next: Tags) => {
    latest.current = next
    setLocal(next)
    // The executor runs at once, so an idle queue sends without waiting.
    const send = () =>
      new Promise<void>((resolve) => resolve(onSave(latest.current)))
    pending.current += 1
    queue.current = (pending.current === 1 ? send() : queue.current.then(send))
      .catch(() => {
        toast.error("Could not save tags")
        latest.current = fromServer.current
        setLocal(fromServer.current)
      })
      .finally(() => {
        pending.current -= 1
      })
  }
  return [local, save] as const
}

/**
 * A card's tags as a token field: the chips, then a field that is always
 * there to type into, completing from the Account's other tags.
 */
export function ChannelCardTags({
  tags,
  virtualGroupTagName,
  inheritedSettingsHint,
  accountChannels,
  onSave,
  onFilterByTag,
}: {
  tags: Channel["tags"]
  virtualGroupTagName: string | null
  inheritedSettingsHint: string
  /** The Account's Channels, which suggestions are drawn from. */
  accountChannels: readonly Pick<Channel, "tags">[]
  onSave: (tags: Tags) => Promise<void> | void
  /** Adds a tag funnel to the Channel filter. */
  onFilterByTag: (tag: string) => void
}) {
  const [local, save] = useSerialTagSaves(tags, onSave)
  const [value, setValue] = useState("")
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(-1)
  const listId = useId()
  const chips = normalizeChannelTags(local)
  const names = chips.map((t) => t.name)
  const namesKey = names.join("\u0000")
  // Computed only while the field has focus: a grid holds hundreds of cards.
  const suggestions = useMemo(
    () => (focused ? cardTagSuggestions(accountChannels, names) : []),
    [focused, accountChannels, namesKey],
  )
  const rows = matchCardTags(suggestions, value).slice(0, 8)
  const open = rows.length > 0

  const add = (raw: string) => {
    setValue("")
    setActive(-1)
    const tag = raw.trim()
    if (!tag) return
    if (isVirtualGroupTag(tag)) {
      toast.error('Tags starting with "group:" are reserved for setting groups')
      return
    }
    save(addManualTag(local, tag))
  }
  // What was typed, in an existing tag's spelling when one matches.
  const addTyped = (typed: string) => {
    const key = typed.trim().toLowerCase()
    add(suggestions.find((s) => s.tag.toLowerCase() === key)?.tag ?? typed)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const chosen = rows[active]?.tag
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, rows.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, -1))
    } else if (e.key === "Tab" && rows.length && (value.trim() || chosen)) {
      // With nothing typed or highlighted, Tab leaves the field as usual.
      e.preventDefault()
      add(chosen ?? rows[0].tag)
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (chosen) add(chosen)
      else addTyped(value)
    } else if (e.key === "Escape") {
      e.currentTarget.blur()
    } else if (e.key === "Backspace" && !value && names.length) {
      save(removeTagsByName(local, [names[names.length - 1]]))
    }
  }

  return (
    <div className="mb-5 flex flex-wrap items-center gap-1.5">
      {virtualGroupTagName && (
        <span
          className="text-[10px] font-bold px-2 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-700 rounded-md"
          title={inheritedSettingsHint}
        >
          {virtualGroupTagName}
        </span>
      )}
      {chips.map((tag) => (
        <span
          key={tag.name.toLowerCase()}
          className="text-[10px] font-bold px-2 py-1 bg-app-ink/5 border border-app-ink/10 flex items-center gap-1.5 group/tag rounded-md text-app-ink/80"
        >
          <button
            type="button"
            title={`Show only channels tagged ${tag.name}`}
            onClick={(e) => {
              e.stopPropagation()
              onFilterByTag(tag.name)
            }}
            className="hover:underline"
          >
            {tag.name}
          </button>
          {tag.source === "ai" && (
            <span
              title="Added by AI"
              className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500/80"
            />
          )}
          <button
            type="button"
            aria-label={`Remove tag ${tag.name}`}
            onClick={(e) => {
              e.stopPropagation()
              save(removeTagsByName(local, [tag.name]))
            }}
            className="opacity-0 group-hover/tag:opacity-50 hover:!opacity-100 focus-visible:!opacity-100 transition-opacity"
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <Popover.Root open={open}>
        <Popover.Anchor asChild>
          <input
            value={value}
            role="combobox"
            aria-label="Add tag"
            {...shortcut("t")}
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            placeholder={names.length ? "+ tag" : "+ add a tag"}
            autoComplete="off"
            spellCheck={false}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false)
              setValue("")
              setActive(-1)
            }}
            onChange={(e) => {
              const typed = e.target.value
              if (typed.endsWith(",")) addTyped(typed.slice(0, -1))
              else {
                setValue(typed)
                setActive(-1)
              }
            }}
            onKeyDown={onKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="min-w-16 flex-1 bg-transparent px-1 py-1 text-[10px] font-bold text-app-ink placeholder:text-app-ink/35 placeholder:font-normal focus:outline-none"
          />
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content
            id={listId}
            role="listbox"
            align="start"
            sideOffset={4}
            onOpenAutoFocus={(e) => e.preventDefault()}
            // Keeps focus in the field while a row is clicked.
            onMouseDown={(e) => e.preventDefault()}
            className="z-50 w-56 rounded-lg border border-app-ink/10 bg-app-card p-1 text-xs text-app-ink shadow-xl"
          >
            {rows.map((r, i) => (
              <button
                key={r.tag}
                type="button"
                role="option"
                aria-selected={i === active}
                title={`On ${r.total} Channel${r.total === 1 ? "" : "s"}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => add(r.tag)}
                className={`block w-full truncate rounded px-2 py-1 text-left ${i === active ? "bg-app-ink/10" : ""}`}
              >
                {r.tag}
              </button>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
