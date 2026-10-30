// PROTOTYPE (complete-window): never merge. ADR-043's Incomplete Channels on
// the Summarize modal, the Action and Posts tabs, History and the Summary
// page, switchable with `?variant=` (0 = main). The check is the prototype
// API's `/proto/*`; syncs and every action go to the real API.

import { useQuery } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { headers } from "@/api/base"

export const VARIANTS = [
  { key: "0", name: "Current" },
  { key: "D", name: "Gate dialog, banners" },
]

// An unknown key (A, B or C, all dropped) is main, never a half-rendered variant.
const asked = new URLSearchParams(window.location.search).get("variant")
let variant = VARIANTS.some((v) => v.key === asked) ? (asked as string) : "0"
const listeners = new Set<() => void>()

/** For plain functions (the "+" menu's offer) that cannot call a hook. */
/** The Coverage tab belongs to every variant but main. */
export const coverageTabOffered = () => variant !== "0"

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
    router.history.replace(url.pathname + url.search)
    for (const l of listeners) l()
  }
  return [current, set]
}

/**
 * True while a gated action runs: the gate already synced or skipped, so
 * main's pre-Summary and pre-Chat syncs stand down. Always false in variant 0.
 */
export let gateOwnsSync = false
export const setGateOwnsSync = (v: boolean) => {
  gateOwnsSync = v
}

/** Every Artifact kind History lists. */
export type ArtifactKind = "summary" | "chat" | "tag" | "discovery"

/** What the Coverage tab draws: the current Scope, or one Artifact as it froze. */
export type ChartSource =
  | { kind: "live" }
  | { kind: "artifact"; artifactKind: ArtifactKind; id: string }
let chartSource: ChartSource = { kind: "live" }
const chartListeners = new Set<() => void>()
export const setChartSource = (next: ChartSource) => {
  chartSource = next
  for (const l of chartListeners) l()
}
export const useChartSource = () =>
  useSyncExternalStore(
    (cb) => {
      chartListeners.add(cb)
      return () => chartListeners.delete(cb)
    },
    () => chartSource,
  )

// ---- The check ---------------------------------------------------------------

export type Reason =
  | "skipped"
  | "failed"
  | "timed_out"
  | "refused"
  | "end"
  | "hole"
  | "start"
  | "retention"
  | "frozen"

export interface Stretch {
  kind: "end" | "hole" | "start"
  from: number
  to: number
}

export interface ChannelCheck {
  name: string
  lastSync: number | null
  reasons: Reason[]
  reason: Reason | null
  error: string | null
  missingIds: number
  stretches: Stretch[]
  syncable: boolean
  /** Behind by more than this (two sync intervals) is overdue, not routine. */
  behindLimit?: number
  /** Posts an hour over the week before its last sync; null when unknown. */
  rate?: number | null
  /** Posts held inside the window. */
  held?: number
}

export interface WindowCheck {
  freeze: number
  start: number
  end: number
  channels: ChannelCheck[]
  ms?: number
  /** Posts the window holds across every Channel. */
  posts?: number
}

/** What an Artifact froze: its Incomplete Channels only, and how many it had. */
export interface ArtifactCheck {
  checked: boolean
  reconstructed?: boolean
  freeze?: number
  start?: number
  end?: number
  channels?: ChannelCheck[]
  total?: number
  choice?: string
  /** Left out of the selection by "complete only". */
  excluded?: string[]
  /** Posts the window held across every Channel; absent on older runs. */
  posts?: number
}

export const REASON_LABEL: Record<Reason, string> = {
  skipped: "Skipped by you",
  failed: "Sync failed",
  timed_out: "Timed out",
  refused: "Refused",
  end: "Not synced to the end",
  hole: "Hole in the window",
  start: "History short of the start",
  retention: "Before the retention cutoff",
  frozen: "Frozen",
}

/** The tone each reason reads in: red is something went wrong, amber is not yet. */
export const REASON_TONE: Record<Reason, "red" | "amber" | "slate"> = {
  skipped: "amber",
  failed: "red",
  timed_out: "red",
  refused: "red",
  end: "amber",
  hole: "amber",
  start: "amber",
  retention: "slate",
  frozen: "slate",
}

const post = async <T>(path: string, body: unknown): Promise<T> => {
  const res = await fetch(`/proto${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`prototype API ${res.status}`)
  return res.json() as Promise<T>
}

export const checkWindow = (
  channels: string[],
  start: number,
  end: number,
  freeze?: number,
) => post<WindowCheck>("/completeness", { channels, start, end, freeze })

export const recordRun = (run: {
  freeze: number
  start: number
  end: number
  choice: string
  kind: string
  channels: ChannelCheck[]
  total: number
  posts?: number
  /** "complete only": the Incomplete Channels the selection dropped. */
  excluded: string[]
}) => post<ArtifactCheck>("/runs", run)

const ORDER = Object.keys(REASON_LABEL) as Reason[]

/** The Incomplete Channels, what a person can act on first. */
export const incompleteOf = (check: WindowCheck | ArtifactCheck | undefined) =>
  (check?.channels ?? [])
    .filter((c) => c.reason)
    .sort(
      (a, b) =>
        ORDER.indexOf(a.reason as Reason) - ORDER.indexOf(b.reason as Reason) ||
        a.name.localeCompare(b.name),
    )

/**
 * Only behind, and not by much: nothing but "not synced to the end" (a skip
 * of it too), within two of the Channel's sync intervals. The gate's sync
 * fixes it as a matter of course; a Live window makes nearly every Channel
 * this. Past the limit it is overdue, which is worth a look.
 */
export const isRoutine = (c: ChannelCheck) =>
  c.syncable &&
  c.reasons.filter((r) => r !== "skipped").join() === "end" &&
  unproven(c) <= (c.behindLimit ?? 2 * 60 * 60_000)

/** How much of the window this Channel cannot vouch for, in ms. */
export const unproven = (c: ChannelCheck) =>
  c.stretches.reduce((n, s) => n + Math.max(0, s.to - s.from), 0)

/**
 * About how many Posts this Channel may lack: a hole's missing ids exactly,
 * every other stretch at the Channel's own pace.
 */
export const lacks = (c: ChannelCheck) =>
  c.missingIds +
  ((c.rate ?? 0) *
    c.stretches
      .filter((s) => s.kind !== "hole")
      .reduce((n, s) => n + Math.max(0, s.to - s.from), 0)) /
    3_600_000

/**
 * The Posts an Incomplete window may lack, as a share of what it holds:
 * "~340 Posts (7%)", "~40+" when a Channel's pace is unknown. A Channel that
 * posts nothing lacks nothing, however far behind it is.
 */
export function postsPhrase(incomplete: ChannelCheck[], held?: number) {
  const n = Math.round(incomplete.reduce((sum, c) => sum + lacks(c), 0))
  // A Channel with no known pace may lack any number: the sum is a floor.
  const floor = incomplete.some(
    (c) => c.rate == null && c.stretches.some((s) => s.kind !== "hole"),
  )
  if (n === 0) return floor ? "an unknown number of Posts" : "no Posts expected"
  const share = held ? (n / (held + n)) * 100 : null
  return `~${n.toLocaleString()}${floor ? "+" : ""} ${n === 1 ? "Post" : "Posts"}${
    share === null ? "" : ` (${share < 1 ? "<1" : Math.round(share)}%)`
  }`
}

/** Most Posts at risk first, so the top of a list is where the risk is. */
const gapFirst = (list: ChannelCheck[]) =>
  [...list].sort(
    (a, b) =>
      lacks(b) - lacks(a) ||
      unproven(b) - unproven(a) ||
      a.name.localeCompare(b.name),
  )

/**
 * The Incomplete Channels a sync can fix (problems, then the ones only
 * behind), and the ones no sync can; each part gap-first.
 */
export function byFix(channels: ChannelCheck[]) {
  return {
    fixable: [
      ...gapFirst(channels.filter((c) => c.syncable && !isRoutine(c))),
      ...gapFirst(channels.filter(isRoutine)),
    ],
    stuck: gapFirst(channels.filter((c) => !c.syncable)),
  }
}

/** What a Channel needs looking at for; "behind" when only lagging. */
export type Kind = Reason | "behind"
const KIND_ORDER: Reason[] = [
  "skipped",
  "failed",
  "timed_out",
  "refused",
  "frozen",
  "retention",
  "hole",
  "start",
]
export function kindOf(c: ChannelCheck): Kind {
  if (isRoutine(c)) return "behind"
  // No sync can help a frozen Channel, so its last failure is not the news.
  if (!c.syncable && c.reasons.includes("frozen")) return "frozen"
  return KIND_ORDER.find((r) => c.reasons.includes(r)) ?? c.reason ?? "end"
}
const KIND_WORD: Record<Reason, [string, string]> = {
  skipped: ["skipped", "skipped"],
  failed: ["failed", "failed"],
  timed_out: ["timed out", "timed out"],
  refused: ["refused", "refused"],
  frozen: ["frozen", "frozen"],
  retention: ["past retention", "past retention"],
  hole: ["hole", "holes"],
  start: ["short history", "short histories"],
  end: ["overdue", "overdue"],
}

/**
 * An Incomplete window measured in what it lacks, not in Channels: the
 * problems by kind, then the routine lag, e.g. "3 holes · 6 failed · last 24
 * min on 324". Empty when nothing is Incomplete.
 */
export function measure(incomplete: ChannelCheck[]) {
  const behind = incomplete.filter(isRoutine)
  const problems = incomplete.filter((c) => !isRoutine(c))
  const counts = new Map<Reason, number>()
  for (const c of problems) {
    const k = kindOf(c) as Reason
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const lag = Math.max(0, ...behind.map(unproven))
  const parts = [...counts].map(
    ([k, n]) => `${n} ${KIND_WORD[k][n === 1 ? 0 : 1]}`,
  )
  // A skip of a Channel only behind is still lag, said as lag.
  const skipped = behind.filter((c) => c.reasons.includes("skipped")).length
  if (behind.length)
    parts.push(
      `last ${span(lag)} on ${behind.length}${
        skipped
          ? `, ${skipped === behind.length ? "all" : skipped} skipped`
          : ""
      }`,
    )
  return { behind, problems, lag, phrase: parts.join(" · ") }
}

/**
 * The live check's cache key. The gate reads it too, so it can open on the
 * chip's answer at once instead of waiting for its own.
 */
export const liveKey = (names: string[], start: number, end: number) => [
  "proto",
  "completeness",
  [...names].sort(),
  Math.floor(start / 60_000) * 60_000,
  Math.floor(end / 60_000) * 60_000,
]

/**
 * The live check for the current Scope, for the Action and Posts tabs. A Live
 * window ending now is Incomplete for every Channel synced before this
 * minute, which is the ADR's rule, so the key moves once a minute.
 */
export function useLiveCheck(
  names: string[],
  start: number,
  end: number,
  enabled: boolean,
) {
  // A Live window's bounds move every tick; the check moves once a minute.
  const s = Math.floor(start / 60_000) * 60_000
  const e = Math.floor(end / 60_000) * 60_000
  const key = JSON.stringify([[...names].sort(), s, e])
  // Settle edits first: dragging the window or ticking Channels would
  // otherwise queue one slow check per step.
  const [settled, setSettled] = useState(key)
  useEffect(() => {
    const id = setTimeout(() => setSettled(key), 500)
    return () => clearTimeout(id)
  }, [key])
  const [sorted, qs, qe] = JSON.parse(settled) as [string[], number, number]
  const q = useQuery({
    queryKey: liveKey(sorted, qs, qe),
    queryFn: () => checkWindow(sorted, qs, qe),
    enabled: enabled && sorted.length > 0,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  })
  // A Live window's minute rolling is not an edit: the answer shown is still
  // for these Channels and this span, so it is not dimmed for the 7 to 50 s
  // the next check takes.
  const shape = (n: string[], from: number, to: number) =>
    JSON.stringify([[...n].sort(), to - from])
  const shown = useRef<string | null>(null)
  if (q.data && !q.isPlaceholderData) shown.current = shape(sorted, qs, qe)
  /** The count shown is for another selection or window until this clears. */
  const updating =
    (settled !== key || q.isPlaceholderData) &&
    shown.current !== shape(names, s, e)
  return { ...q, updating }
}

// One POST for every mark History renders at once.
type Pending = { id: string; kind: string; resolve: (c: ArtifactCheck) => void }
let pending: Pending[] = []
let timer: ReturnType<typeof setTimeout> | null = null
const flush = () => {
  const batch = pending
  pending = []
  timer = null
  // Chunks of 8, so the first marks show while the rest are reconstructed.
  for (let i = 0; i < batch.length; i += 8)
    void flushChunk(batch.slice(i, i + 8))
}
const flushChunk = async (batch: Pending[]) => {
  try {
    const answer = await post<Record<string, ArtifactCheck>>(
      "/artifacts/completeness",
      { items: batch.map(({ id, kind }) => ({ id, kind })) },
    )
    for (const b of batch) b.resolve(answer[b.id] ?? { checked: false })
  } catch {
    for (const b of batch) b.resolve({ checked: false })
  }
}
const checkArtifact = (id: string, kind: string) =>
  new Promise<ArtifactCheck>((resolve) => {
    pending.push({ id, kind, resolve })
    timer ??= setTimeout(flush, 80)
  })

/** Every Artifact kind History lists: summary, chat, tag, discovery. */
export function useArtifactCheck(id: string, kind: string, enabled: boolean) {
  return useQuery({
    queryKey: ["proto", "artifactCompleteness", kind, id],
    queryFn: () => checkArtifact(id, kind),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

// ---- Formatting -----------------------------------------------------------------

export const at = (ms: number | null | undefined) =>
  ms
    ? new Date(ms).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "never"

export function span(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000))
  if (m < 60) return `${m} min`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h`
  return `${Math.round(h / 24)} d`
}

const hm = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })

/**
 * How far this Channel falls short of the window's end `e`, in its own terms:
 * "23 min behind", "hole: 4 posts, 18:40 to 18:52". Empty when no stretch
 * says it (a failure or a freeze alone).
 */
export function shortfall(c: ChannelCheck, e: number): string {
  const parts: string[] = []
  // At its own pace, about how many Posts the lag hides.
  const pace = (ms: number) => {
    if (c.rate == null) return ""
    const n = Math.round((c.rate * ms) / 3_600_000)
    return `, ~${n} ${n === 1 ? "post" : "posts"}`
  }
  if (c.reasons.includes("end"))
    parts.push(
      c.lastSync
        ? `${span(e - c.lastSync)} behind${pace(e - c.lastSync)}`
        : "never synced",
    )
  const hole = c.stretches.find((s) => s.kind === "hole")
  if (hole)
    parts.push(
      `hole: ${c.missingIds} ${c.missingIds === 1 ? "post" : "posts"}, ${
        // A hole across midnight needs its dates.
        new Date(hole.from).toDateString() === new Date(hole.to).toDateString()
          ? hm(hole.from)
          : at(hole.from)
      } to ${hm(hole.to)}`,
    )
  const short = c.stretches.find((s) => s.kind === "start")
  if (short) parts.push(`history starts ${span(short.to - short.from)} late`)
  return parts.join(" · ")
}
