// PROTOTYPE: the token-field tag row. Never merge.
import { Popover } from "radix-ui"
import { useRef, useState } from "react"
import { useSettingGroupsQuery } from "@/hooks/useSettingGroups"
import { useWorkspaceGroupParams } from "@/hooks/useWorkspaceGroupParams"
import {
  addFunnel,
  emptyFilter,
  filterNames,
  parseChannelFilter,
  printChannelFilter,
} from "@/lib/channels/channel-filter"
import { normalizeChannelTags } from "@/lib/channels/channel-tag-model"
import type { Channel } from "@/types"
import { CHANNEL_SHORTCUTS } from "../channel-grid/ChannelGridKeyboard"
import {
  type CardVariant,
  GroupChip,
  matchTags,
  TagChip,
  type Tags,
  useLocalTags,
  useTagSuggestions,
} from "./shared"

type Props = {
  variant: Exclude<CardVariant, "0">
  tags: Channel["tags"]
  virtualGroupTagName: string | null
  inheritedSettingsHint: string
  onSave: (tags: Tags) => void
}

export function PrototypeCardTags(p: Props) {
  const t = useLocalTags(p.tags, p.onSave)
  const funnel = useFunnelTag()
  return (
    <div className="mb-5 flex flex-wrap items-center gap-1.5">
      {p.virtualGroupTagName && (
        <GroupChip
          name={p.virtualGroupTagName}
          hint={p.inheritedSettingsHint}
        />
      )}
      {normalizeChannelTags(t.local).map((tag) => (
        <TagChip
          key={tag.name.toLowerCase()}
          name={tag.name}
          ai={tag.source === "ai"}
          onRemove={() => t.remove(tag.name)}
          onClick={() => funnel(tag.name)}
        />
      ))}
      <TokenAdder t={t} />
    </div>
  )
}

type LocalTags = ReturnType<typeof useLocalTags>

/**
 * No button. A borderless field always sits after the chips; focusing it
 * drops a list (↑↓ to move, Tab takes the top match, Enter adds what was
 * typed unless a row was chosen with the arrows), like the bulk bar's field.
 * Clicking a chip's name narrows the grid to that tag.
 */
function TokenAdder({ t }: { t: LocalTags }) {
  const [focused, setFocused] = useState(false)
  const [value, setValue] = useState("")
  const [active, setActive] = useState(-1)
  const anchor = useRef<HTMLInputElement>(null)
  const suggestions = useTagSuggestions(t.names, focused)
  const rows = matchTags(suggestions, value).slice(0, 7)
  const pick = (tag: string) => {
    t.add(tag)
    setValue("")
    setActive(-1)
  }

  return (
    <Popover.Root open={focused && rows.length > 0}>
      <Popover.Anchor asChild>
        <input
          ref={anchor}
          data-shortcut={CHANNEL_SHORTCUTS.tag}
          value={value}
          placeholder={t.names.length ? "+ tag" : "+ add a tag"}
          aria-label="Add tag"
          autoComplete="off"
          spellCheck={false}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            setValue("")
          }}
          onChange={(e) => {
            const v = e.target.value
            if (v.endsWith(",")) pick(v.slice(0, -1))
            else {
              setValue(v)
              setActive(-1)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setActive((i) => Math.min(i + 1, rows.length - 1))
            } else if (e.key === "ArrowUp") {
              e.preventDefault()
              setActive((i) => Math.max(i - 1, -1))
            } else if (
              e.key === "Tab" &&
              rows.length &&
              (value.trim() || active >= 0)
            ) {
              e.preventDefault()
              pick(rows[Math.max(active, 0)].tag)
            } else if (e.key === "Enter") {
              e.preventDefault()
              if (active >= 0 && rows[active]) pick(rows[active].tag)
              else if (value.trim()) {
                const exact = rows.find(
                  (r) => r.tag.toLowerCase() === value.trim().toLowerCase(),
                )
                pick(exact?.tag ?? value)
              }
            } else if (e.key === "Escape") {
              e.currentTarget.blur()
            } else if (e.key === "Backspace" && !value && t.names.length) {
              t.remove(t.names[t.names.length - 1])
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="min-w-16 flex-1 bg-transparent px-1 py-1 text-[10px] font-bold text-app-ink placeholder:text-app-ink/35 placeholder:font-normal focus:outline-none"
        />
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          className="z-50 w-56 rounded-lg border border-app-ink/10 bg-app-card p-1 text-xs text-app-ink shadow-xl"
        >
          {rows.map((r, i) => (
            <button
              key={r.tag}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(r.tag)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left ${i === active ? "bg-app-ink/10" : ""}`}
            >
              <span className="flex-1 truncate">{r.tag}</span>
              {r.together > 0 && !value && (
                <span className="text-[9px] text-app-ink/40">often paired</span>
              )}
              <span className="tabular-nums text-app-ink/40">{r.total}</span>
            </button>
          ))}
          {value.trim() &&
            !rows.some(
              (r) => r.tag.toLowerCase() === value.trim().toLowerCase(),
            ) && (
              <div className="px-2 pt-1 text-[9px] text-app-ink/50">
                Tab takes the top match · Enter adds what you typed
              </div>
            )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** Narrows the Channels grid to one tag, the same as its facet funnel. */
function useFunnelTag() {
  const { channelFilterText, setChannelFilterText } = useWorkspaceGroupParams()
  const { data: groups = [] } = useSettingGroupsQuery()
  return (tag: string) => {
    const names = filterNames(groups)
    const filter = parseChannelFilter(channelFilterText, names) ?? emptyFilter()
    setChannelFilterText(
      printChannelFilter(addFunnel(filter, "tag", tag), names),
    )
  }
}
