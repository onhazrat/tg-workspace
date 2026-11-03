// PROTOTYPE (filter-memory): never merge. Undo/redo, recent filters, saved
// views and selection restore for the Channels, Posts, Directory and History
// tabs, switchable with `?variant=` (0 = main). Frontend only: filters are
// URL state, the Channel selection is local, saved views live in scopedStorage.

import { useRouter } from "@tanstack/react-router"
import { useEffect, useRef, useSyncExternalStore } from "react"
import type { PostSelection } from "@/lib/posts/post-selection"
import type { WindowState } from "@/lib/scope/window"
import type { Tab } from "@/lib/workspace-tabs"
import { WORKSPACE_TABS } from "@/constants"
import { scopedStorage } from "@/lib/storage/scoped"
import type { Action } from "./server-undo"

export const VARIANTS = [
  { key: "0", name: "Current" },
  { key: "E", name: "Filters and selections" },
  { key: "F", name: "Everything" },
]

const asked = new URLSearchParams(window.location.search).get("variant")
let variant = VARIANTS.some((v) => v.key === asked) ? (asked as string) : "0"

/** A tiny observable: listeners plus a version to re-render on. */
function observable() {
  const listeners = new Set<() => void>()
  let version = 0
  return {
    notify() {
      version++
      for (const l of listeners) l()
    },
    use() {
      return useSyncExternalStore(
        (cb) => {
          listeners.add(cb)
          return () => listeners.delete(cb)
        },
        () => version,
      )
    },
  }
}

const variantObs = observable()

/** The variant alone: no router or query client, so main's tests still render. */
export const useVariant = () => {
  variantObs.use()
  return variant
}

export function useProtoVariant(): [string, (next: string) => void] {
  const router = useRouter()
  const current = useVariant()
  const set = (next: string) => {
    variant = next
    const url = new URL(window.location.href)
    url.searchParams.set("variant", next)
    router.history.replace(url.pathname + url.search)
    variantObs.notify()
  }
  return [current, set]
}

// ---- What a tab's state is ---------------------------------------------------

export const MEMORY_TABS = [
  "channels",
  "posts",
  "directory",
  "history",
] as const
export type MemoryTab = (typeof MEMORY_TABS)[number]
export const isMemoryTab = (tab: string): tab is MemoryTab =>
  (MEMORY_TABS as readonly string[]).includes(tab)

/** The URL keys that are this tab's filter. Paging is not a filter. */
export function isFilterKey(tab: MemoryTab, key: string): boolean {
  if (tab === "channels")
    return key === "channelFilter" || key === "settingGroup"
  if (tab === "posts") return key === "postFilter"
  if (tab === "directory") return key.startsWith("dir") && key !== "dirPage"
  return key.startsWith("history")
}

/** Channels and Posts both act on the Channel selection; the others do not. */
export const tabHasSelection = (tab: MemoryTab) =>
  tab === "channels" || tab === "posts"

export type Snapshot = {
  /** E: the tab the state belongs to. F: the active tab, any kind. */
  tab: string
  params: Record<string, string>
  /** Sorted Channel names, or null where the tab has no selection. */
  selection: string[] | null
  /** The Scope's window, on Channels and Posts. */
  window?: WindowState | null
  /** The Directory's ticked handles. */
  ticks?: string[] | null
  /** The Post selection's rules and Picks, on Posts. */
  picks?: PostSelection | null
  /** F: the whole URL search but the variant, every tab's filters included. */
  url?: Record<string, unknown> | null
  /** F: the open tabs in strip order. */
  tabs?: Tab[] | null
  /** F: view state components hold themselves (`useTracked`) and view preferences. */
  ui?: Record<string, unknown> | null
  /** F: a server write this row made, and the requests that take it back. */
  action?: Action
  /**
   * The entry this one was changed from. D's timeline keeps every entry, so a
   * change after an undo starts a branch instead of dropping the undone ones.
   * Absent means the entry before it.
   */
  parent?: number
  at: number
}

/** Which of the extra parts a tab's snapshot holds. */
export const tabHasWindow = (tab: MemoryTab) =>
  tab === "channels" || tab === "posts"

export function sliceOf(
  search: Record<string, unknown>,
  tab: MemoryTab,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(search))
    if (value !== undefined && value !== null && isFilterKey(tab, key))
      out[key] = String(value)
  return out
}

export const stateKey = (s: Omit<Snapshot, "at">) =>
  JSON.stringify([
    s.tab,
    s.params,
    s.selection,
    s.window ?? null,
    s.ticks ?? null,
    s.picks ?? null,
    s.url ?? null,
    s.tabs ?? null,
    s.ui ?? null,
  ])

const LABELS: Record<string, string> = {
  channelFilter: "",
  postFilter: "",
  settingGroup: "group",
  dirQ: "search",
  dirFilter: "",
  dirIn: "in",
  dirKinds: "kinds",
  dirYours: "yours",
  dirSort: "sort",
  dirOrder: "order",
  dirMatches: "matches",
  historyQ: "search",
  historyKind: "kind",
  historyStatus: "status",
  historyStarred: "starred",
  historyTime: "time",
  historyMoment: "by",
  historySort: "sort",
  historyOrder: "order",
}

/** The filter as one line of text a person can read. */
export function describeFilter(params: Record<string, string>): string {
  const parts = Object.entries(params).map(([k, v]) => {
    const label = LABELS[k] ?? k
    return label ? `${label}: ${v}` : v
  })
  return parts.join(" · ") || "No filter"
}

const span = (ms: number) => {
  const m = Math.round(ms / 60000)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  const parts = [d && `${d}d`, h && `${h}h`, m % 60 && `${m % 60}m`]
  return parts.filter(Boolean).join(" ") || "0m"
}
const day = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

export function describeWindow(w: WindowState): string {
  if (w.mode === "fixed") return `${day(w.start)} → ${day(w.end)}`
  const gap = w.endGapMs ? `, ending ${span(w.endGapMs)} ago` : ""
  return `last ${span(w.durationMs)}${gap}`
}

export function describe(s: Snapshot): string {
  const parts = [describeFilter(s.params)]
  if (s.selection) parts.push(`${s.selection.length} Channels`)
  if (s.window) parts.push(describeWindow(s.window))
  if (s.picks?.length) {
    const picks = s.picks.filter((p) => p.kind === "pick").length
    const rules = s.picks.length - picks
    parts.push(
      [
        picks && `${picks} picked`,
        rules && `${rules} rule${rules === 1 ? "" : "s"}`,
      ]
        .filter(Boolean)
        .join(", "),
    )
  }
  if (s.ticks?.length) parts.push(`${s.ticks.length} ticked`)
  return parts.join(" — ")
}

// ---- F: a row says what changed since the state it came from -------------

const KIND_LABEL: Record<string, string> = Object.fromEntries(
  WORKSPACE_TABS.map((t) => [t.id, t.label]),
)
export const kindLabel = (kind: string) => KIND_LABEL[kind] ?? kind
const tabLabel = (t: Tab) =>
  t.id ? `${kindLabel(t.kind)} ${t.id.slice(0, 6)}` : kindLabel(t.kind)
const tabId = (t: Tab) => `${t.kind}:${t.id ?? ""}`
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** "Opened Summary 3f2a1c · Went to Posts · postFilter: …"; a first row says where it began. */
export function describeChange(
  prev: Snapshot | undefined,
  next: Snapshot,
): string {
  if (!prev) return `Start on ${kindLabel(next.tab)}`
  const parts: string[] = []
  const before = (prev.tabs ?? []).map(tabId)
  const after = (next.tabs ?? []).map(tabId)
  for (const t of next.tabs ?? [])
    if (!before.includes(tabId(t))) parts.push(`Opened ${tabLabel(t)}`)
  for (const t of prev.tabs ?? [])
    if (!after.includes(tabId(t))) parts.push(`Closed ${tabLabel(t)}`)
  const kept = before.filter((id) => after.includes(id))
  const keptAfter = after.filter((id) => before.includes(id))
  if (kept.join() !== keptAfter.join()) {
    const moved = (next.tabs ?? []).find(
      (t) => kept.indexOf(tabId(t)) !== keptAfter.indexOf(tabId(t)),
    )
    parts.push(moved ? `Moved ${tabLabel(moved)}` : "Reordered tabs")
  }
  if (prev.tab !== next.tab) parts.push(`Went to ${kindLabel(next.tab)}`)
  const a = prev.url ?? {}
  const b = next.url ?? {}
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key === "tab" || same(a[key], b[key])) continue
    parts.push(
      b[key] === undefined ? `${key} cleared` : `${key}: ${String(b[key])}`,
    )
  }
  if (!same(prev.selection, next.selection))
    parts.push(
      `Channels selected ${prev.selection?.length ?? 0} → ${next.selection?.length ?? 0}`,
    )
  if (!same(prev.window, next.window) && next.window)
    parts.push(`Window: ${describeWindow(next.window)}`)
  if (!same(prev.picks, next.picks))
    parts.push(`Post selection: ${next.picks?.length ?? 0} steps`)
  if (!same(prev.ticks, next.ticks))
    parts.push(`Directory ticks: ${next.ticks?.length ?? 0}`)
  const ua = prev.ui ?? {}
  const ub = next.ui ?? {}
  for (const key of new Set([...Object.keys(ua), ...Object.keys(ub)]))
    if (!same(ua[key], ub[key])) parts.push(`${key} changed`)
  return parts.join(" · ") || "No visible change"
}

// ---- The timeline: every entry, a cursor, and each entry's parent ----------

type Line = { entries: Snapshot[]; cursor: number }
const lines = new Map<string, Line>()
export const historyObs = observable()

// Both timelines outlive a reload: E's ("all") and F's ("everything").
const storageKey = (key: string) =>
  key === "all" ? "filterMemoryPrototype.timeline" : `filterMemoryPrototype.${key}`
// ponytail: whole timeline rewritten per change, capped at 100; a large
// selection per row can near the storage quota, trim selections if it does.
const TIMELINE_CAP = 100

export function line(key: string): Line {
  let l = lines.get(key)
  if (!l) {
    l = { entries: [], cursor: -1 }
    try {
      l = JSON.parse(scopedStorage.getItem(storageKey(key)) ?? "") as Line
    } catch {}
    lines.set(key, l)
  }
  return l
}

function changed(key: string) {
  scopedStorage.setItem(storageKey(key), JSON.stringify(line(key)))
  historyObs.notify()
}

const parentOf = (l: Line, i: number) => l.entries[i]?.parent ?? i - 1

/** The newest entry changed from `i`, or -1. */
function childOf(l: Line, i: number): number {
  for (let j = l.entries.length - 1; j > i; j--)
    if (parentOf(l, j) === i) return j
  return -1
}

/** The cursor, then what it was changed from, back to the first entry. */
export function ancestors(key: string): number[] {
  const l = line(key)
  const out: number[] = []
  for (let i = l.cursor; i >= 0; i = parentOf(l, i)) out.push(i)
  return out
}

/**
 * Records a state unless it is the one the cursor is on (an undo landing).
 * It appends and branches from the cursor, so no undone entry is dropped.
 */
/** A view change this soon after a server write is that write's own effect. */
const FOLD_MS = 2500

export function record(key: string, snap: Snapshot) {
  const l = line(key)
  const here = l.entries[l.cursor]
  if (here && stateKey(here) === stateKey(snap)) return
  if (here?.action && snap.at - here.at < FOLD_MS) {
    l.entries[l.cursor] = {
      ...snap,
      action: here.action,
      parent: here.parent,
      at: here.at,
    }
    return changed(key)
  }
  push(key, { ...snap, parent: l.cursor })
}

/** F: a server write becomes a row holding the view as it stands. */
export function recordAction(key: string, action: Action) {
  const l = line(key)
  const here = l.entries[l.cursor]
  if (!here) return
  push(key, { ...here, action, at: Date.now(), parent: l.cursor })
}

function push(key: string, entry: Snapshot) {
  const l = line(key)
  l.entries.push(entry)
  if (l.entries.length > TIMELINE_CAP) {
    l.entries.shift()
    l.entries = l.entries.map((e, i) => ({
      ...e,
      parent: Math.max(-1, (e.parent ?? i) - 1),
    }))
  }
  l.cursor = l.entries.length - 1
  changed(key)
}

/**
 * The rows passed going from the cursor to `to`: up to the shared ancestor
 * (each one undone) and down from it (each one redone).
 */
export function path(
  key: string,
  to: number,
): { up: number[]; down: number[] } {
  const l = line(key)
  const chain = (from: number) => {
    const out: number[] = []
    for (let i = from; i >= 0; i = parentOf(l, i)) out.push(i)
    return out
  }
  const mine = chain(l.cursor)
  const theirs = chain(to)
  const shared = mine.find((i) => theirs.includes(i)) ?? -1
  return {
    up: mine.slice(
      0,
      mine.indexOf(shared) === -1 ? mine.length : mine.indexOf(shared),
    ),
    down: theirs
      .slice(
        0,
        theirs.indexOf(shared) === -1 ? theirs.length : theirs.indexOf(shared),
      )
      .reverse(),
  }
}

export const parentAt = (key: string, i: number) => parentOf(line(key), i)
export const childAt = (key: string, i: number) => childOf(line(key), i)

/** The row undo or redo lands on, or -1. */
export const target = (key: string, by: number) => {
  const l = line(key)
  return by < 0 ? parentOf(l, l.cursor) : childOf(l, l.cursor)
}
const targetOf = (l: Line, by: number) =>
  by < 0 ? parentOf(l, l.cursor) : childOf(l, l.cursor)

export const canStep = (key: string, by: number) => targetOf(line(key), by) >= 0

/** Back to what the cursor was changed from, or forward to its newest change. */
export function step(key: string, by: number): Snapshot | null {
  const l = line(key)
  const next = targetOf(l, by)
  if (next < 0) return null
  l.cursor = next
  changed(key)
  return l.entries[next]
}

export function jump(key: string, index: number): Snapshot {
  const l = line(key)
  l.cursor = index
  changed(key)
  return l.entries[index]
}

// ---- Recent filters and saved views, kept per account ----------------------

const SAVED_KEY = "filterMemoryPrototype.saved"
export const storedObs = observable()

function readList<T>(key: string): T[] {
  try {
    return JSON.parse(scopedStorage.getItem(key) ?? "[]") as T[]
  } catch {
    return []
  }
}
function writeList<T>(key: string, list: T[]) {
  scopedStorage.setItem(key, JSON.stringify(list))
  storedObs.notify()
}

export type SavedView = Snapshot & { id: string; name: string }
export const savedViews = (tab?: MemoryTab) =>
  readList<SavedView>(SAVED_KEY).filter((v) => !tab || v.tab === tab)

export function saveView(snap: Snapshot, name: string) {
  const all = readList<SavedView>(SAVED_KEY)
  all.push({ ...snap, id: crypto.randomUUID(), name })
  writeList(SAVED_KEY, all)
}
export function deleteView(id: string) {
  writeList(
    SAVED_KEY,
    readList<SavedView>(SAVED_KEY).filter((v) => v.id !== id),
  )
}

// ---- The timeline's keys, for keyboard mode's corner and full list ---------

type KeyRow = readonly [keys: string, what: string]

/** Keyboard mode's keys for the timeline: none in variant 0. */
export const timelineKeys = (v: string): KeyRow[] =>
  v === "0"
    ? []
    : [
        ["u / U", "undo / redo a filter or selection change"],
        ["h", "the timeline of filters and selections"],
      ]

/** The undo keys that work with keyboard mode off too. */
export const timelineAnywhereKeys = (
  v: string,
  commandKey: string,
): KeyRow[] =>
  v === "0"
    ? []
    : [
        [`${commandKey}+Z`, "undo a filter or selection change"],
        [`${commandKey}+Shift+Z`, "redo it"],
      ]

/** The drawer's own keys while it is open. */
export const TIMELINE_DRAWER_KEYS: KeyRow[] = [
  ["j / k", "next / previous row"],
  ["Enter", "go there"],
  ["s", "save the row as a view"],
  ["t", "this tab only, or every tab"],
  ["h or Esc", "close the timeline"],
]

// ---- F: view state components keep in their own useState ------------------

const tracked = new Map<string, { value: unknown; set: (v: unknown) => void }>()
export const trackedObs = observable()

/** Sets and Maps as JSON, so a snapshot can hold them and survive a reload. */
const toJson = (v: unknown) =>
  JSON.parse(
    JSON.stringify(v, (_k, x) =>
      x instanceof Set
        ? { $set: [...x] }
        : x instanceof Map
          ? { $map: [...x] }
          : x,
    ) ?? "null",
  )
const fromJson = (v: unknown) =>
  JSON.parse(JSON.stringify(v), (_k, x) =>
    x && typeof x === "object" && "$set" in x
      ? new Set(x.$set)
      : x && typeof x === "object" && "$map" in x
        ? new Map(x.$map)
        : x,
  )

/**
 * A component's own view state joins F's timeline: one line beside its
 * useState. Does nothing a reader of variant 0 can see.
 */
export function useTracked<T>(key: string, value: T, set: (v: T) => void) {
  const setRef = useRef(set)
  setRef.current = set
  const json = JSON.stringify(toJson(value))
  useEffect(() => {
    tracked.set(key, {
      value: JSON.parse(json),
      set: (v) => setRef.current(fromJson(v) as T),
    })
    trackedObs.notify()
  }, [key, json])
  useEffect(
    () => () => {
      tracked.delete(key)
      trackedObs.notify()
    },
    [key],
  )
}

export const readTracked = (): Record<string, unknown> =>
  Object.fromEntries([...tracked].map(([k, t]) => [k, t.value]))

/** Puts each tracked value back whose component is mounted and differs. */
export function writeTracked(ui: Record<string, unknown>) {
  for (const [key, value] of Object.entries(ui)) {
    const t = tracked.get(key)
    if (t && JSON.stringify(t.value) !== JSON.stringify(value)) t.set(value)
  }
}
