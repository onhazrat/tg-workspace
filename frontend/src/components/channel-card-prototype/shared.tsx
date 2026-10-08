// PROTOTYPE: channel card improvements, switchable with ?variant= on the
// Channels tab. Throwaway; never merge. Question: how should the compact card
// show freshness, and how should "+ Add tag" take typed tags with completion?
import { useNavigate, useSearch } from "@tanstack/react-router"
import { X } from "lucide-react"
import { createContext, useContext, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { PrototypeSwitcher } from "@/components/Common/PrototypeSwitcher"
import { useData } from "@/contexts/DataContext"
import {
  addManualTag,
  getTagNames,
  normalizeChannelTags,
  removeTagsByName,
} from "@/lib/channels/channel-tag-model"
import { isVirtualGroupTag } from "@/lib/channels/virtual-group-tags"
import type { Channel } from "@/types"

// Verdict so far: tiles as today, compact B, tags C, D's behaviour, and E's
// stat tiles for the card and detailed card. D2/D3 (schedules) and F/G
// (side rail, profile sheet) lost. Every key but 0 carries D's behaviour.
export const VARIANTS = [
  { key: "0", name: "Current" },
  { key: "D", name: "Coloured sync age, token-field tags" },
  { key: "E", name: "D · stat tiles" },
]

export type CardVariant = "0" | "D" | "E"

/** The variant in the URL; D when absent. Only the Channels grid reads it. */
export function useUrlCardVariant(): CardVariant {
  const search = useSearch({ strict: false }) as { variant?: string }
  const v = search.variant
  return VARIANTS.some((x) => x.key === v) ? (v as CardVariant) : "D"
}

/**
 * The variant as the grid hands it to its cards. The default is 0, so 0 is
 * exactly main: anything outside the provider, every existing unit test
 * included, gets today's card. Every change must sit behind D.
 */
export const CardVariantContext = createContext<CardVariant>("0")

export const useCardVariant = () => useContext(CardVariantContext)

export function CardVariantSwitcher() {
  const navigate = useNavigate()
  const current = useUrlCardVariant()
  return (
    <PrototypeSwitcher
      variants={VARIANTS}
      current={current}
      onChange={(key) =>
        navigate({
          to: ".",
          search: (prev: Record<string, unknown>) => ({
            ...prev,
            variant: key,
          }),
          replace: true,
        })
      }
    />
  )
}

export type Tags = NonNullable<Channel["tags"]>

export type Suggestion = {
  tag: string
  /** Channels carrying the tag. */
  total: number
  /** Of those, channels that share at least one tag with this one. */
  together: number
}

/**
 * Tags this channel lacks, best first: the ones that keep company with its
 * current tags, then the most used. Computed only while an editor is open.
 */
export function useTagSuggestions(
  current: readonly string[],
  enabled: boolean,
): Suggestion[] {
  const { channels } = useData()
  const key = current.join("\u0000")
  return useMemo(() => {
    if (!enabled) return []
    const mine = new Set(key.toLowerCase().split("\u0000").filter(Boolean))
    const total = new Map<string, number>()
    const together = new Map<string, number>()
    for (const channel of channels) {
      const names = getTagNames(channel.tags)
      const near = names.some((t) => mine.has(t.toLowerCase()))
      for (const tag of names) {
        total.set(tag, (total.get(tag) ?? 0) + 1)
        if (near) together.set(tag, (together.get(tag) ?? 0) + 1)
      }
    }
    return [...total.keys()]
      .filter((tag) => !mine.has(tag.toLowerCase()) && !isVirtualGroupTag(tag))
      .map((tag) => ({
        tag,
        total: total.get(tag) ?? 0,
        together: together.get(tag) ?? 0,
      }))
      .sort(
        (a, b) =>
          b.together - a.together ||
          b.total - a.total ||
          a.tag.localeCompare(b.tag),
      )
  }, [channels, key, enabled])
}

/** Prefix matches first, then substring matches, in suggestion order. */
export function matchTags(suggestions: Suggestion[], typed: string) {
  const q = typed.trim().toLowerCase()
  if (!q) return suggestions
  const prefix = suggestions.filter((s) => s.tag.toLowerCase().startsWith(q))
  const inner = suggestions.filter(
    (s) =>
      !s.tag.toLowerCase().startsWith(q) && s.tag.toLowerCase().includes(q),
  )
  return [...prefix, ...inner]
}

/**
 * The tag list with an optimistic copy, so several tags typed in a row each
 * land on top of the last rather than on the stale prop.
 * ponytail: two saves in flight may arrive out of order; the real version
 * should send add/remove deltas instead of whole lists.
 */
export function useLocalTags(tags: Channel["tags"], onSave: (t: Tags) => void) {
  const [local, setLocal] = useState<Tags>(tags ?? [])
  useEffect(() => setLocal(tags ?? []), [tags])
  const save = (next: Tags) => {
    setLocal(next)
    onSave(next)
  }
  const names = normalizeChannelTags(local).map((t) => t.name)
  const add = (raw: string): boolean => {
    const tag = raw.trim()
    if (!tag) return false
    if (isVirtualGroupTag(tag)) {
      toast.error('Tags starting with "group:" are reserved for setting groups')
      return false
    }
    if (names.some((n) => n.toLowerCase() === tag.toLowerCase())) return false
    save(addManualTag(local, tag))
    return true
  }
  const remove = (name: string) => save(removeTagsByName(local, [name]))
  return { local, names, add, remove }
}

export function TagChip({
  name,
  ai,
  onRemove,
  onClick,
}: {
  name: string
  ai: boolean
  onRemove: () => void
  onClick?: () => void
}) {
  return (
    <span className="text-[10px] font-bold px-2 py-1 bg-app-ink/5 border border-app-ink/10 flex items-center gap-1.5 group/tag rounded-md text-app-ink/80">
      {onClick ? (
        <button
          type="button"
          title={`Show only channels tagged ${name}`}
          onClick={(e) => {
            e.stopPropagation()
            onClick()
          }}
          className="hover:underline"
        >
          {name}
        </button>
      ) : (
        name
      )}
      {ai && (
        <span
          title="Added by AI"
          className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500/80"
        />
      )}
      <button
        type="button"
        aria-label={`Remove tag ${name}`}
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        className="opacity-0 group-hover/tag:opacity-50 hover:!opacity-100 focus-visible:!opacity-100 transition-opacity"
      >
        <X size={10} />
      </button>
    </span>
  )
}

export function GroupChip({ name, hint }: { name: string; hint: string }) {
  return (
    <span
      className="text-[10px] font-bold px-2 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-700 rounded-md"
      title={hint}
    >
      {name}
    </span>
  )
}

/** Age of the last successful sync as a colour: a day, a week, older. */
export function freshness(lastUpdated: number | undefined) {
  if (!lastUpdated)
    return {
      dot: "bg-app-ink/25",
      ring: "ring-app-ink/20",
      text: "text-app-ink/50",
    }
  const hours = (Date.now() - lastUpdated) / 3_600_000
  if (hours < 24)
    return {
      dot: "bg-emerald-500",
      ring: "ring-emerald-500",
      text: "text-emerald-700",
    }
  if (hours < 24 * 7)
    return {
      dot: "bg-amber-500",
      ring: "ring-amber-500",
      text: "text-amber-700",
    }
  return { dot: "bg-red-500", ring: "ring-red-500", text: "text-red-600" }
}
