/**
 * The Post selection (PTR-05, ADR-026): what an Action covers, apart from
 * what the Posts tab shows.
 *
 * An ordered list of steps. A Selection rule selects or deselects every Post
 * a Post filter matches, kept as the filter was (cap and seed included), so
 * it reaches the matching Posts of the next window too. A Pick selects or
 * deselects one Post. The last step to reach a Post decides it. The server
 * evaluates the list; the browser only appends to it, shows it as chips and
 * sends it.
 */

import { scopedSessionStorage } from "@/lib/storage/scoped"
import {
  isEmptyPostFilter,
  type PostFilter,
  postConditionLabel,
  printPostFilter,
} from "./post-filter"
import type {
  MaxPostsPerChannelMode,
  PostSortOrder,
  ViewMeasure,
} from "./post-view"

/** A Post filter as it was when a rule was made. */
export type PostFilterSnapshot = {
  tree: PostFilter | null
  keyword: string | null
  sort: PostSortOrder
  viewMeasure: ViewMeasure
  maxPerChannel: number
  maxPerChannelMode: MaxPostsPerChannelMode
  seed: number
}

export type SelectionRule = {
  kind: "rule"
  select: boolean
  filter: PostFilterSnapshot
}
export type SelectionPick = {
  kind: "pick"
  select: boolean
  channelName: string
  postId: number
}
export type SelectionStep = SelectionRule | SelectionPick
export type PostSelection = SelectionStep[]

/** The server's bounds (`schemas/post_filter.py`). */
export const MAX_PICKS = 5000
export const MAX_RULES = 50

export const EMPTY_SNAPSHOT: PostFilterSnapshot = {
  tree: null,
  keyword: null,
  sort: "newest",
  viewMeasure: "estimated",
  maxPerChannel: 0,
  maxPerChannelMode: "ordered",
  seed: 0,
}

/** Select all: the default, and what an unfiltered select-all leaves. */
export const DEFAULT_SELECTION: PostSelection = [
  { kind: "rule", select: true, filter: EMPTY_SNAPSHOT },
]

/** A rule reaches every Post only with no tree, no keyword and no cap. */
export const isEmptySnapshot = (s: PostFilterSnapshot): boolean =>
  (s.tree === null || isEmptyPostFilter(s.tree)) &&
  !s.keyword?.trim() &&
  s.maxPerChannel <= 0

export function snapshotOf(view: {
  filter: PostFilter
  keyword: string
  sort: PostSortOrder
  viewMeasure: ViewMeasure
  maxPerChannel: number
  maxPerChannelMode: MaxPostsPerChannelMode
  seed: number
}): PostFilterSnapshot {
  return {
    tree: isEmptyPostFilter(view.filter) ? null : view.filter,
    keyword: view.keyword.trim() || null,
    sort: view.sort,
    viewMeasure: view.viewMeasure,
    maxPerChannel: view.maxPerChannel,
    maxPerChannelMode: view.maxPerChannelMode,
    seed: view.seed,
  }
}

export const rule = (
  select: boolean,
  filter: PostFilterSnapshot = EMPTY_SNAPSHOT,
): SelectionRule => ({ kind: "rule", select, filter })

export const pick = (
  select: boolean,
  post: { channelName: string; id: number },
): SelectionPick => ({
  kind: "pick",
  select,
  channelName: post.channelName,
  postId: post.id,
})

type Loaded = { channelName: string; id: number }
export const postKey = (p: Loaded) => `${p.channelName}:${p.id}`

/**
 * The Picks a click records: the clicked Post, or with shift every loaded
 * Post from the last click to this one, each set to `select`. A last click
 * no longer loaded makes it a plain click.
 */
export function runPicks(
  posts: Loaded[],
  clicked: Loaded,
  select: boolean,
  anchor: string | null,
): SelectionPick[] {
  const to = posts.findIndex((p) => postKey(p) === postKey(clicked))
  const from = anchor ? posts.findIndex((p) => postKey(p) === anchor) : -1
  const run =
    from < 0 || to < 0
      ? [clicked]
      : posts.slice(Math.min(from, to), Math.max(from, to) + 1)
  return run.map((p) => pick(select, p))
}

/**
 * `steps` with `added` appended, compacted where they are appended: a rule
 * over an empty filter reaches every Post, so it replaces everything before
 * it. Nothing else is compacted, so removing a chip always undoes exactly
 * its own steps. A string when a bound refuses, saying what to do instead.
 */
export function appendSteps(
  steps: PostSelection,
  added: SelectionStep[],
): PostSelection | string {
  let next = steps
  for (const step of added)
    next =
      step.kind === "rule" && isEmptySnapshot(step.filter)
        ? [step]
        : [...next, step]
  const picks = next.filter((s) => s.kind === "pick").length
  if (picks > MAX_PICKS)
    return `A selection holds at most ${MAX_PICKS.toLocaleString()} single Posts. Select or deselect them with a filter instead, which records one rule.`
  if (next.length - picks > MAX_RULES)
    return `A selection holds at most ${MAX_RULES} rules. Remove a few chips, or start again with Select all.`
  return next
}

// ---- Chips -----------------------------------------------------------------

/** One chip: a rule, or a run of Picks in one direction, as `steps[start..end)`. */
export type SelectionChip = {
  start: number
  end: number
  select: boolean
  label: string
}

const treeLabel = (tree: PostFilter): string => {
  const only = tree.children.length === 1 ? tree.children[0] : null
  if (!tree.not && only?.kind === "atom")
    return `${only.not ? "not " : ""}${postConditionLabel(only.cond)}`
  return printPostFilter(tree)
}

/** "all", "Arabic", "“tehran” · 5 per Channel": what a rule reaches. */
export function snapshotLabel(s: PostFilterSnapshot): string {
  if (isEmptySnapshot(s)) return "all"
  const parts: string[] = []
  if (s.tree && !isEmptyPostFilter(s.tree)) parts.push(treeLabel(s.tree))
  if (s.keyword?.trim()) parts.push(`“${s.keyword.trim()}”`)
  if (s.maxPerChannel > 0)
    parts.push(
      `${s.maxPerChannel}${s.maxPerChannelMode === "random" ? " random" : ""} per Channel`,
    )
  return parts.join(" · ")
}

/** The steps in order as chips: "Select all · Deselect Arabic · −3 posts". */
export function selectionChips(steps: PostSelection): SelectionChip[] {
  const chips: SelectionChip[] = []
  steps.forEach((step, i) => {
    const last = chips.at(-1)
    if (step.kind === "pick") {
      const prev = steps[i - 1]
      if (last && prev?.kind === "pick" && prev.select === step.select) {
        last.end = i + 1
        const n = last.end - last.start
        last.label = `${step.select ? "+" : "−"}${n} posts`
        return
      }
      chips.push({
        start: i,
        end: i + 1,
        select: step.select,
        label: `${step.select ? "+" : "−"}1 post`,
      })
      return
    }
    chips.push({
      start: i,
      end: i + 1,
      select: step.select,
      label: `${step.select ? "Select" : "Deselect"} ${snapshotLabel(step.filter)}`,
    })
  })
  return chips
}

/** Remove one chip's steps and nothing else. */
export const removeChip = (
  steps: PostSelection,
  chip: Pick<SelectionChip, "start" | "end">,
): PostSelection => [...steps.slice(0, chip.start), ...steps.slice(chip.end)]

// ---- The wire --------------------------------------------------------------

/** The steps as the server reads them: a rule's empty tree is `null`. */
export const selectionBody = (steps: PostSelection): SelectionStep[] =>
  steps.map((step) =>
    step.kind === "pick"
      ? step
      : {
          ...step,
          filter: {
            ...step.filter,
            tree:
              step.filter.tree && !isEmptyPostFilter(step.filter.tree)
                ? step.filter.tree
                : null,
          },
        },
  )

// ---- Session storage -------------------------------------------------------

/** Per Account and per browser session (`scopedSessionStorage`). */
export const SELECTION_STORAGE_KEY = "postSelection"

const isStep = (value: unknown): value is SelectionStep => {
  if (typeof value !== "object" || value === null) return false
  const step = value as Record<string, unknown>
  if (typeof step.select !== "boolean") return false
  if (step.kind === "pick")
    return (
      typeof step.channelName === "string" && typeof step.postId === "number"
    )
  return (
    step.kind === "rule" &&
    typeof step.filter === "object" &&
    step.filter !== null
  )
}

/** The stored selection, or the default when there is none or it is unreadable. */
export function loadSelection(): PostSelection {
  try {
    const raw = scopedSessionStorage.getItem(SELECTION_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (Array.isArray(parsed) && parsed.every(isStep)) return parsed
  } catch {
    /* unreadable: start from the default */
  }
  return DEFAULT_SELECTION
}

export function saveSelection(steps: PostSelection): void {
  scopedSessionStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(steps))
}
