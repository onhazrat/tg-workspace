import type { TabType } from "@/constants"
import { DIRECTORY_PARAMS } from "@/lib/directory/directory-view"
import { artifactDestination } from "@/lib/history/open-artifact"
import type { WorkspaceSearch } from "@/lib/workspace-search"
import type { ArtifactListItem } from "@/types"

/**
 * The workspace tab strip as a value: which tabs are open, in what order, and
 * which one each operation leaves active (TABS-01).
 *
 * No React and no storage, so every rule below is pinned by
 * `workspace-tabs.test.ts` rather than by a browser. The active tab is *not*
 * part of the state: it lives in the URL (`?tab=` plus the Artifact param), and
 * each operation takes it in and hands the next one back for the caller to
 * navigate to.
 *
 * A tab is its kind plus its Artifact id, or its kind alone when empty. The two
 * invariants every operation keeps (no two tabs for one Artifact, no two empty
 * tabs of one kind) make that pair unique, so there is no synthetic tab id and
 * the URL can address any tab.
 */

/** Always open, always first, never moved. */
export const FIXED_TABS = ["channels", "posts", "action"] as const

const FIXED_ACTION: Tab = { kind: "action" }

/** The kinds whose tab holds at most one Artifact, and the param naming it. */
export const ARTIFACT_PARAMS = {
  summary: "summary",
  chat: "chatSession",
  tag: "tagRun",
  discover: "report",
} as const satisfies Partial<Record<TabType, keyof WorkspaceSearch>>

export type ArtifactTabKind = keyof typeof ARTIFACT_PARAMS

export interface Tab {
  kind: TabType
  /** Only on an Artifact tab, and only when it holds one. */
  id?: string
}

export interface TabSet {
  /** The open Closable tabs, in strip order. */
  tabs: readonly Tab[]
  /** Set by closing History, so making more Artifacts does not bring it back. */
  historyClosed: boolean
  /** Session memory for "Reopen closed tab", most recently closed last. */
  closed: readonly Tab[]
  /** Session memory for "Go to <kind>", most recently active first. */
  recent: readonly Tab[]
}

/** The set an operation produced, and the tab it leaves active. */
export interface Step {
  set: TabSet
  active: Tab
}

export function emptyTabSet(): TabSet {
  return { tabs: [], historyClosed: false, closed: [], recent: [] }
}

export function isFixed(kind: TabType): boolean {
  return (FIXED_TABS as readonly TabType[]).includes(kind)
}

export function isArtifactKind(kind: TabType): kind is ArtifactTabKind {
  return kind in ARTIFACT_PARAMS
}

export function sameTab(a: Tab, b: Tab): boolean {
  return a.kind === b.kind && (a.id ?? null) === (b.id ?? null)
}

/** `kind:id`, the key reconcile matches against. */
export function artifactKey(kind: TabType, id: string): string {
  return `${kind}:${id}`
}

/** A tab's identity as one string: `kind:id`, or the kind of an empty tab. */
export function tabKey(t: Tab): string {
  return t.id ? artifactKey(t.kind, t.id) : t.kind
}

/** A tab as it may exist: an id only where the kind holds an Artifact. */
function tab(kind: TabType, id?: string | null): Tab {
  return isArtifactKind(kind) && id ? { kind, id } : { kind }
}

/** Every tab in the strip: the Fixed ones, then the open Closable ones. */
export function strip(set: TabSet): Tab[] {
  return [...FIXED_TABS.map((kind) => ({ kind })), ...set.tabs]
}

function isOpen(set: TabSet, target: Tab): boolean {
  return isFixed(target.kind) || set.tabs.some((t) => sameTab(t, target))
}

function withTab(set: TabSet, target: Tab): TabSet {
  if (isOpen(set, target)) return set
  return {
    ...set,
    tabs: [...set.tabs, target],
    historyClosed: target.kind === "history" ? false : set.historyClosed,
  }
}

/**
 * Focus the tab for `kind` (and `id`), opening it at the end if it has none.
 *
 * An Artifact that has a tab is focused rather than opened twice, and an empty
 * open of a kind that already has an empty tab focuses that tab.
 */
export function open(set: TabSet, kind: TabType, id?: string | null): Step {
  const target = tab(kind, id)
  return { set: withTab(set, target), active: target }
}

/**
 * A new Artifact of `kind` exists: fill that kind's empty tab, or append.
 *
 * Shown only when that is where the user still is: on Action where they
 * started it, or on the tab it fills. A run that finishes after they moved on
 * lands in its tab without pulling them back to it.
 */
export function create(
  set: TabSet,
  active: Tab,
  kind: ArtifactTabKind,
  id: string,
): Step {
  const target = tab(kind, id)
  const follows =
    active.kind === "action" ||
    sameTab(active, { kind }) ||
    sameTab(active, target)
  const shown = follows ? target : active
  if (isOpen(set, target)) return { set, active: shown }
  const empty = set.tabs.findIndex((t) => sameTab(t, { kind }))
  const tabs =
    empty === -1
      ? [...set.tabs, target]
      : set.tabs.map((t, i) => (i === empty ? target : t))
  return { set: { ...set, tabs }, active: shown }
}

/** The tab to activate instead of `target`: the nearest kept one to its
 * right, else to its left. */
function neighbour(
  set: TabSet,
  target: Tab,
  kept: (t: Tab) => boolean = (t) => !sameTab(t, target),
): Tab {
  const all = strip(set)
  const at = all.findIndex((t) => sameTab(t, target))
  return (
    all.slice(at + 1).find(kept) ??
    all.slice(0, at).reverse().find(kept) ??
    FIXED_ACTION
  )
}

/** Close a Closable tab; a Fixed tab stays. */
export function close(set: TabSet, active: Tab, target: Tab): Step {
  if (isFixed(target.kind) || !isOpen(set, target)) return { set, active }
  const next: TabSet = {
    ...set,
    tabs: set.tabs.filter((t) => !sameTab(t, target)),
    closed: [...set.closed, target],
    historyClosed: target.kind === "history" ? true : set.historyClosed,
  }
  return {
    set: next,
    active: sameTab(active, target) ? neighbour(set, target) : active,
  }
}

/**
 * Drag `target` onto `over`'s place (TABS-02).
 *
 * Only Closable tabs move, and only among themselves: a Fixed `target` stays,
 * and a drop onto a Fixed tab clamps to the first Closable place, so the
 * Fixed tabs are never passed. A tab that is not open moves nothing.
 */
export function move(set: TabSet, target: Tab, over: Tab): TabSet {
  const from = set.tabs.findIndex((t) => sameTab(t, target))
  const to = isFixed(over.kind)
    ? 0
    : set.tabs.findIndex((t) => sameTab(t, over))
  if (from === -1 || to === -1 || from === to) return set
  const tabs = [...set.tabs]
  tabs.splice(to, 0, ...tabs.splice(from, 1))
  return { ...set, tabs }
}

/** Bring back the most recently closed tab, with its Artifact. */
export function reopenLast(set: TabSet, active: Tab): Step {
  const last = set.closed.at(-1)
  if (!last) return { set, active }
  return open({ ...set, closed: set.closed.slice(0, -1) }, last.kind, last.id)
}

/**
 * Line the set up with the account's Artifacts.
 *
 * A tab whose Artifact is gone (deleted here, on another device, or pruned by
 * retention) closes silently and is not offered by "Reopen closed tab". History
 * joins the strip once the account has an Artifact, unless the user closed it.
 */
export function reconcile(
  set: TabSet,
  active: Tab,
  artifacts: { known: ReadonlySet<string>; hasArtifacts: boolean },
): Step {
  const exists = (t: Tab) => !t.id || artifacts.known.has(tabKey(t))
  const dropped = set.tabs.some((t) => !exists(t))
  const next =
    set.tabs.some((t) => sameTab(t, active)) && !exists(active)
      ? neighbour(set, active, exists)
      : active
  let tabs = set.tabs.filter(exists)
  const addHistory =
    artifacts.hasArtifacts &&
    !set.historyClosed &&
    !tabs.some((t) => t.kind === "history")
  if (addHistory) tabs = [{ kind: "history" }, ...tabs]
  if (!dropped && !addHistory && next === active) return { set, active }
  return {
    set: { ...set, tabs, closed: set.closed.filter(exists) },
    active: next,
  }
}

/** The URL landed on `target`: make sure it has a tab, and remember the visit. */
export function visit(set: TabSet, target: Tab): TabSet {
  const opened = withTab(set, target)
  return {
    ...opened,
    recent: [target, ...opened.recent.filter((t) => !sameTab(t, target))],
  }
}

/**
 * "Go to <kind>": the most recently active open tab of that kind, else its
 * empty tab (opened if it has none).
 */
export function goTo(set: TabSet, kind: TabType): Step {
  const recent = set.recent.find((t) => t.kind === kind && isOpen(set, t))
  return recent ? { set, active: recent } : open(set, kind)
}

/**
 * The search for `target`, keeping every param that is not an Artifact param.
 *
 * Only the target's own Artifact param survives. Spreading the previous ones
 * forward is what kept an hour-old Summary alive on the Summary tab. The
 * Directory's view rides only on the Directory tab: it means nothing anywhere
 * else, and a Directory opened without it adopts the remembered one.
 */
export function tabSearch(prev: WorkspaceSearch, target: Tab): WorkspaceSearch {
  const search: WorkspaceSearch = { ...prev, tab: target.kind }
  for (const param of Object.values(ARTIFACT_PARAMS)) delete search[param]
  if (target.kind !== "directory")
    for (const param of DIRECTORY_PARAMS) delete search[param]
  if (isArtifactKind(target.kind) && target.id) {
    search[ARTIFACT_PARAMS[target.kind]] = target.id
  }
  return search
}

/** The active tab named by a validated search. */
export function tabFromSearch(search: WorkspaceSearch): Tab {
  const kind = search.tab ?? "channels"
  return tab(kind, isArtifactKind(kind) ? search[ARTIFACT_PARAMS[kind]] : null)
}

/**
 * Look the open tabs' Artifacts up in the History list, which is paged: walk
 * pages until every key is found or the list ends. `any` says whether the
 * account has an Artifact at all.
 */
export async function findTabArtifacts(
  keys: readonly string[],
  pageSize: number,
  listPage: (offset: number) => Promise<ArtifactListItem[]>,
) {
  const wanted = new Set(keys)
  const found = new Map<string, ArtifactListItem>()
  let any = false
  for (let offset = 0; ; offset += pageSize) {
    const page = await listPage(offset)
    any ||= page.length > 0
    for (const row of page) {
      const key = artifactKey(artifactDestination(row).tab, row.id)
      if (wanted.has(key)) found.set(key, row)
    }
    if (page.length < pageSize || found.size === wanted.size) {
      return { wanted, found, any }
    }
  }
}
