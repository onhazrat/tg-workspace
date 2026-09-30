/**
 * PROTOTYPE, throwaway: four ways to follow a channel from A5's bar. Every
 * write is stubbed by `stubWrites`, so these only show what would be sent.
 */
import { AtSign, Check as CheckIcon, Plus, Search, X } from "lucide-react"
import type React from "react"
import { useState } from "react"
import { TgButton } from "@/components/ui/tg-button"
import { TgInput } from "@/components/ui/tg-input"
import { normalizeChannelHandle } from "@/lib/channels/add-channel"
import { cn } from "@/lib/utils"
import type { Channel } from "@/types"
import { Pop, PopLabel } from "./Pop"
import type { ChannelControlsProps } from "./types"

export type FollowLayout = "pop" | "inline" | "omnibox" | "bulk" | "row"

type Parsed = {
  raw: string
  handle: string
  status: "new" | "following" | "invalid"
}

// ponytail: Telegram's public-username shape, not a lookup; the real add still asks Telegram.
const HANDLE = /^[A-Za-z0-9_]{4,32}$/

export function parseHandle(raw: string, channels: Channel[]): Parsed {
  const handle = normalizeChannelHandle(raw)
  const following = channels.some(
    (c) => c.name.toLowerCase() === handle.toLowerCase(),
  )
  return {
    raw,
    handle,
    status: !HANDLE.test(handle) ? "invalid" : following ? "following" : "new",
  }
}

/** Every handle in pasted text, split on whitespace and commas, deduplicated. */
export function parseHandles(text: string, channels: Channel[]): Parsed[] {
  const seen = new Set<string>()
  return text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((raw) => parseHandle(raw, channels))
    .filter((p) => {
      const key = p.handle.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

const STATUS_TEXT: Record<Parsed["status"], string> = {
  new: "will follow",
  following: "already following",
  invalid: "not a handle",
}

const StatusLine: React.FC<{ parsed: Parsed }> = ({ parsed }) => (
  <span
    className={cn(
      "text-[10px] font-semibold",
      parsed.status === "new" && "text-green-600",
      parsed.status === "following" && "text-app-ink/50",
      parsed.status === "invalid" && "text-red-500",
    )}
  >
    @{parsed.handle || "…"} · {STATUS_TEXT[parsed.status]}
  </span>
)

/** The follow control on row 1, in whichever shape `layout` names. */
export const FollowControl: React.FC<
  ChannelControlsProps & {
    layout: FollowLayout
    rowOpen: boolean
    onRowOpenChange: (open: boolean) => void
  }
> = ({ layout, rowOpen, onRowOpenChange, ...p }) => {
  if (layout === "omnibox") return null
  if (layout === "row")
    return (
      <TgButton
        variant={rowOpen ? "primary" : "secondary"}
        size="sm"
        className="h-9 gap-1.5"
        aria-expanded={rowOpen}
        onClick={() => onRowOpenChange(!rowOpen)}
      >
        {rowOpen ? <X size={13} /> : <Plus size={13} />}
        Follow
      </TgButton>
    )
  if (layout === "inline") return <InlineFollow {...p} />
  if (layout === "bulk") return <BulkFollow {...p} />
  return (
    <Pop
      align="end"
      trigger={
        <TgButton variant="secondary" size="sm" className="h-9 gap-1.5">
          <Plus size={13} />
          Follow
        </TgButton>
      }
      className="w-72"
    >
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          p.onAddChannel()
        }}
      >
        <TgInput
          autoFocus
          variant="muted"
          value={p.inlineChannelName}
          onChange={(e) => p.onInlineChannelNameChange(e.target.value)}
          placeholder="@telegram_channel"
          className="h-9 py-0"
        />
        <TgButton
          type="submit"
          size="sm"
          className="h-9"
          disabled={!p.inlineChannelName.trim()}
        >
          Add
        </TgButton>
      </form>
    </Pop>
  )
}

/** F1: an always-visible field that widens while you use it. */
const InlineFollow: React.FC<ChannelControlsProps> = (p) => {
  const value = p.inlineChannelName
  const parsed = value.trim() ? parseHandle(value, p.channels) : null
  return (
    <form
      id="tour-add-channel"
      className="relative"
      onSubmit={(e) => {
        e.preventDefault()
        if (parsed?.status === "new") p.onAddChannel()
      }}
    >
      <AtSign
        size={13}
        className="pointer-events-none absolute left-2.5 top-[11px] text-app-ink/40"
      />
      <TgInput
        variant="muted"
        value={value}
        onChange={(e) => p.onInlineChannelNameChange(e.target.value)}
        placeholder="Follow a channel"
        className="h-9 w-44 py-0 pl-8 pr-9 transition-[width] focus:w-72"
      />
      <button
        type="submit"
        aria-label="Follow"
        disabled={parsed?.status !== "new"}
        className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-md bg-app-ink text-app-bg disabled:bg-app-ink/10 disabled:text-app-ink/30"
      >
        <Plus size={13} />
      </button>
      {parsed && (
        <div className="absolute left-1 top-full z-30 mt-1 whitespace-nowrap rounded-md border border-app-ink/10 bg-app-card px-2 py-1 shadow">
          <StatusLine parsed={parsed} />
        </div>
      )}
    </form>
  )
}

/** F3: paste any number of handles or links, see each one's fate, follow them together. */
const BulkFollow: React.FC<ChannelControlsProps> = (p) => {
  const [text, setText] = useState("")
  const [groupId, setGroupId] = useState(
    p.groups.find((g) => g.isDefault)?.id ?? "",
  )
  const parsed = parseHandles(text, p.channels)
  const fresh = parsed.filter((x) => x.status === "new")
  return (
    <Pop
      align="start"
      trigger={
        <TgButton variant="secondary" size="sm" className="h-9 gap-1.5">
          <Plus size={13} />
          Follow
        </TgButton>
      }
      className="w-96"
    >
      <PopLabel>
        Handles or t.me links, one per line or comma separated
      </PopLabel>
      {/* Radix focuses the first field in the popover, so no autoFocus. */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"@durov\nhttps://t.me/telegram\nt.me/s/bbcpersian"}
        rows={4}
        className="w-full resize-y rounded-md border border-app-ink/15 bg-app-muted/40 p-2 font-mono text-[11px] outline-none focus:border-app-ink/40"
      />
      {parsed.length > 0 && (
        <div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto px-1">
          {parsed.map((x) => (
            <div key={x.handle} className="flex items-center gap-2">
              {x.status === "new" ? (
                <CheckIcon size={11} className="text-green-600" />
              ) : (
                <X size={11} className="text-app-ink/40" />
              )}
              <StatusLine parsed={x} />
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 px-1 text-[11px] font-semibold">
        into
        <select
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="h-8 flex-1 rounded-md border border-app-ink/15 bg-app-card px-2 text-[11px]"
        >
          {p.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
              {g.isDefault ? " (default)" : ""}
            </option>
          ))}
        </select>
        <TgButton
          size="sm"
          disabled={fresh.length === 0}
          onClick={() =>
            p.onFollowNames(
              fresh.map((x) => x.handle),
              groupId,
            )
          }
        >
          Follow {fresh.length || ""}
        </TgButton>
      </div>
    </Pop>
  )
}

/** F4: a full-width row that opens under row 1 with room to explain itself. */
export const FollowRow: React.FC<
  ChannelControlsProps & { onClose: () => void }
> = ({ onClose, ...p }) => {
  const value = p.inlineChannelName
  const parsed = value.trim() ? parseHandle(value, p.channels) : null
  return (
    <form
      id="tour-add-channel"
      className="flex flex-wrap items-center gap-3 border-t border-app-ink/10 bg-app-muted/30 px-3 py-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (parsed?.status === "new") p.onAddChannel()
      }}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="relative min-w-[260px] flex-1">
        <AtSign
          size={15}
          className="pointer-events-none absolute left-3 top-[13px] text-app-ink/40"
        />
        <TgInput
          autoFocus
          variant="muted"
          value={value}
          onChange={(e) => p.onInlineChannelNameChange(e.target.value)}
          placeholder="channel handle, @handle, t.me/handle or t.me/s/handle"
          className="h-10 py-0 pl-9 text-[13px]"
        />
      </div>
      <div className="min-w-40">
        {parsed ? (
          <StatusLine parsed={parsed} />
        ) : (
          <span className="text-[10px] text-app-ink/45">
            Syncs its history once followed
          </span>
        )}
      </div>
      <TgButton
        type="submit"
        size="sm"
        className="h-10 px-4"
        disabled={parsed?.status !== "new"}
      >
        Follow
      </TgButton>
      <TgButton
        type="button"
        variant="ghost"
        size="sm"
        className="h-10"
        onClick={onClose}
      >
        Cancel
      </TgButton>
    </form>
  )
}

/** F2: the search box proposes following what you typed when it names no channel you have. */
export const OmniSearch: React.FC<ChannelControlsProps> = (p) => {
  const [open, setOpen] = useState(false)
  const query = p.channelSearch
  const parsed = query.trim() ? parseHandle(query, p.channels) : null
  const follow = () => {
    if (parsed?.status !== "new") return
    p.onFollowNames([parsed.handle])
    setOpen(false)
  }
  return (
    <div className="relative min-w-[200px] flex-1" id="tour-add-channel">
      <Search
        size={14}
        className="pointer-events-none absolute inset-y-0 left-3 my-auto text-app-ink/40"
      />
      <TgInput
        variant="muted"
        value={query}
        onChange={(e) => {
          p.onChannelSearchChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && p.filteredCount === 0) follow()
          if (e.key === "Escape") setOpen(false)
        }}
        placeholder="Search your channels, or paste a handle to follow"
        className="h-9 py-0 pl-9"
      />
      {open && parsed && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-app-ink/15 bg-app-card text-[11px] shadow-xl">
          <div className="px-3 py-2 text-app-ink/60">
            {p.filteredCount} of your channels match “{query}”
          </div>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={follow}
            disabled={parsed.status !== "new"}
            className="flex w-full items-center gap-2 border-t border-app-ink/10 px-3 py-2 text-left font-semibold hover:bg-app-ink/5 disabled:cursor-default disabled:hover:bg-transparent"
          >
            <Plus size={12} />
            {parsed.status === "new" ? (
              <>
                Follow @{parsed.handle}
                {p.filteredCount === 0 && (
                  <kbd className="ml-auto rounded border border-app-ink/20 px-1 text-[9px] text-app-ink/50">
                    Enter
                  </kbd>
                )}
              </>
            ) : (
              <StatusLine parsed={parsed} />
            )}
          </button>
        </div>
      )}
    </div>
  )
}
