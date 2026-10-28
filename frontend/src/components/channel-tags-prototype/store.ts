// PROTOTYPE (channel-tags-usage): never merge. Variants of the Tags dropdown
// (order by usage, rename and delete, one component in both tabs), the Groups
// gear and Last synced / Last post, switchable with `?variant=` (0 = main).

import { useQuery } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { useSyncExternalStore } from "react"
import { headers } from "@/api/base"
import { sameTag } from "@/lib/directory/directory-tags"
import { formatCount } from "@/lib/format-count"
import { queryClient } from "@/lib/queryClient"
import { scopedStorage } from "@/lib/storage/scoped"

export const VARIANTS = [
  { key: "0", name: "Current" },
  { key: "A", name: "Tags by use on this tab" },
  { key: "B", name: "A + server use, frozen order, merge warning, last post" },
]

let variant = new URLSearchParams(window.location.search).get("variant") ?? "0"
const listeners = new Set<() => void>()

/** For module-level code (labels) that cannot call a hook. */
export const isProto = () => variant !== "0"

/** The variant alone: no router or query client, so main's tests still render. */
export const useVariant = () =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => variant,
  )

export function useProtoVariant(): [string, (next: string) => void] {
  const router = useRouter()
  const current = useVariant()
  const set = (next: string) => {
    variant = next
    const url = new URL(window.location.href)
    url.searchParams.set("variant", next)
    // Through the router's history, so its next navigation keeps the param.
    router.history.replace(url.pathname + url.search)
    for (const l of listeners) l()
  }
  return [current, set]
}

/** Rename and delete in the Tags dropdown, and order by use: A and B. */
export const canManage = (v: string) => v !== "0"
export const tagOrder = (v: string) => v === "A" || v === "B"
/**
 * B: use is kept on the server, so every device shares one order; counts come
 * from one route; the order holds while a dropdown is open; a rename onto
 * another Tag asks first; Last post shows on cards and has a preset.
 */
export const isB = (v: string) => v === "B"

const post = (path: string, body: unknown) =>
  fetch(`/proto${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  })

// ---- Usage -----------------------------------------------------------------

/** Each tab orders its Tags by its own use: a funnel here says nothing there. */
export type TagTab = "channels" | "directory" | "requests"

const HALF_LIFE_MS = 14 * 86_400_000
const decay = (at: number, now: number) => 0.5 ** ((now - at) / HALF_LIFE_MS)
const logKey = (tab: TagTab) => `proto_tagUse_${tab}`

type UseLog = Record<string, number[]>
const readUse = (tab: TagTab): UseLog => {
  try {
    return JSON.parse(scopedStorage.getItem(logKey(tab)) ?? "{}") as UseLog
  } catch {
    return {}
  }
}
const logs: Record<TagTab, UseLog> = {
  channels: readUse("channels"),
  directory: readUse("directory"),
  requests: readUse("requests"),
}
const useListeners = new Set<() => void>()

function save(tab: TagTab, log: UseLog) {
  logs[tab] = log
  scopedStorage.setItem(logKey(tab), JSON.stringify(log))
  for (const l of useListeners) l()
}

/** Record one use of a Tag on `tab`: a tick, a funnel, tagging with it, a rename. */
export function bumpTagUse(tab: TagTab, name: string) {
  if (isB(variant)) {
    void post("/tags/uses", { tab, name }).then(() =>
      queryClient.invalidateQueries({ queryKey: ["proto", "tagUses", tab] }),
    )
    return
  }
  const key = name.toLowerCase()
  const log = logs[tab]
  // ponytail: last 50 uses per Tag per tab in browser storage; a server table if it ships.
  save(tab, { ...log, [key]: [...(log[key] ?? []), Date.now()].slice(-50) })
}

/** A rename is the Account's, so both tabs carry the old name's history over. */
export function renameTagUse(tab: TagTab, from: string, to: string) {
  if (isB(variant)) {
    void post("/tags/uses/rename", { name: from, to }).then(() =>
      queryClient
        .invalidateQueries({ queryKey: ["proto", "tagUses"] })
        .then(() => bumpTagUse(tab, to)),
    )
    return
  }
  for (const t of ["channels", "directory", "requests"] as const) {
    const { [from.toLowerCase()]: old = [], ...rest } = logs[t]
    const key = to.toLowerCase()
    save(t, { ...rest, [key]: [...(rest[key] ?? []), ...old].sort() })
  }
  bumpTagUse(tab, to)
}

export type Usage = { score: number; last: number | null }

/** Each Tag's use on `tab`, or null outside variant A. */
export function useTagUsage(
  v: string,
  tab: TagTab,
): (name: string) => Usage | null {
  const log = useSyncExternalStore(
    (cb) => {
      useListeners.add(cb)
      return () => useListeners.delete(cb)
    },
    () => logs[tab],
  )
  const server = useQuery({
    queryKey: ["proto", "tagUses", tab],
    queryFn: async () =>
      (await (
        await fetch(`/proto/tags/uses?tab=${tab}`, { headers: headers() })
      ).json()) as Record<string, Usage>,
    enabled: isB(v),
  })
  if (!tagOrder(v)) return () => null
  if (isB(v)) return (name) => server.data?.[name.toLowerCase()] ?? null
  const now = Date.now()
  return (name) => {
    const uses = log[name.toLowerCase()] ?? []
    return {
      score: uses.reduce((sum, at) => sum + decay(at, now), 0),
      last: uses.at(-1) ?? null,
    }
  }
}

/** Highest usage first, then most channels, then by name. */
export function byUsage<T>(
  items: T[],
  usage: (name: string) => Usage | null,
  name: (item: T) => string,
  count: (item: T) => number,
): T[] {
  return [...items].sort(
    (a, b) =>
      (usage(name(b))?.score ?? 0) - (usage(name(a))?.score ?? 0) ||
      count(b) - count(a) ||
      name(a).localeCompare(name(b)),
  )
}

const ago = (at: number) => {
  const days = (Date.now() - at) / 86_400_000
  if (days < 1 / 24) return "just now"
  if (days < 1) return `${Math.round(days * 24)}h ago`
  return `${Math.round(days)}d ago`
}

/** The row hint that shows why a Tag sits where it does. */
export const usageHint = (u: Usage | null) =>
  u && u.score > 0
    ? `${u.score < 10 ? u.score.toFixed(1) : formatCount(Math.round(u.score))} · ${u.last ? ago(u.last) : ""}`
    : undefined

/** B: what renaming `from` onto another Tag's name would merge, or undefined. */
export function mergeText(
  tags: { name: string; channels: number }[],
  from: string,
  to: string,
): string | undefined {
  const target = tags.find((t) => sameTag(t.name, to) && !sameTag(t.name, from))
  if (!target) return undefined
  const n = tags.find((t) => sameTag(t.name, from))?.channels ?? 0
  return `"${target.name}" is already a Tag, on ${target.channels} channels. Renaming "${from}" to it merges the two: its ${n} channels get "${target.name}", and they can't be split apart again.`
}
