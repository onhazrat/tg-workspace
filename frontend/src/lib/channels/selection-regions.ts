/**
 * Selection edits relative to what the filters show (CTB-04). S is the
 * selection, F the Shown Channels, and every edit keeps or drops three regions:
 *
 *   hidden  S − F  the Hidden selection
 *   both    S ∩ F  selected and shown
 *   fresh   F − S  shown, not selected
 *
 * so the five named edits are rows of one table, and any other picture is a
 * "custom" edit made by clicking the Venn.
 */
export type Regions = { hidden: boolean; both: boolean; fresh: boolean }

export type SelectionEditKey = "add" | "remove" | "keep" | "invert" | "replace"

export type SelectionEdit = {
  key: SelectionEditKey
  label: string
  detail: string
  regions: Regions
}

export const SELECTION_EDITS: readonly SelectionEdit[] = [
  {
    key: "add",
    label: "Add shown",
    detail: "Keep the selection, add every shown Channel",
    regions: { hidden: true, both: true, fresh: true },
  },
  {
    key: "remove",
    label: "Remove shown",
    detail: "Keep the selection, drop the shown ones",
    regions: { hidden: true, both: false, fresh: false },
  },
  {
    key: "keep",
    label: "Keep only shown",
    detail: "Drop selected Channels the filters hide",
    regions: { hidden: false, both: true, fresh: false },
  },
  {
    key: "invert",
    label: "Invert shown",
    detail: "Flip the shown Channels, leave hidden ones as they are",
    regions: { hidden: true, both: false, fresh: true },
  },
  {
    key: "replace",
    label: "Select only shown",
    detail: "Exactly the shown Channels, nothing else",
    regions: { hidden: false, both: true, fresh: true },
  },
]

/** The picture that changes nothing, which is where the Venn opens. */
export const UNCHANGED: Regions = { hidden: true, both: true, fresh: false }

export function regionsOf(selection: ReadonlySet<string>, shown: string[]) {
  const shownSet = new Set(shown)
  return {
    hidden: [...selection].filter((n) => !shownSet.has(n)),
    both: shown.filter((n) => selection.has(n)),
    fresh: shown.filter((n) => !selection.has(n)),
  }
}

export function applyRegions(
  selection: ReadonlySet<string>,
  shown: string[],
  keep: Regions,
): Set<string> {
  const r = regionsOf(selection, shown)
  return new Set([
    ...(keep.hidden ? r.hidden : []),
    ...(keep.both ? r.both : []),
    ...(keep.fresh ? r.fresh : []),
  ])
}

/** The named edit a picture is, or undefined for a custom one. */
export const editFor = (keep: Regions) =>
  SELECTION_EDITS.find(
    (e) =>
      e.regions.hidden === keep.hidden &&
      e.regions.both === keep.both &&
      e.regions.fresh === keep.fresh,
  )

/** How many members each region holds. */
export type RegionCounts = Record<keyof Regions, number>

/** "52 → 30 selected, −40 dropped, +18 added", from the regions' sizes alone. */
export function changeOf(counts: RegionCounts, keep: Regions) {
  const dropped =
    (keep.hidden ? 0 : counts.hidden) + (keep.both ? 0 : counts.both)
  const added = keep.fresh ? counts.fresh : 0
  const before = counts.hidden + counts.both
  return { before, after: before - dropped + added, dropped, added }
}

/** Counts for "52 → 30 selected, −40 dropped, +18 added". */
export function selectionChange(
  selection: ReadonlySet<string>,
  shown: string[],
  keep: Regions,
) {
  const r = regionsOf(selection, shown)
  return changeOf(
    { hidden: r.hidden.length, both: r.both.length, fresh: r.fresh.length },
    keep,
  )
}

/** Would applying `keep` leave the selection as it is? */
export function isNoop(
  selection: ReadonlySet<string>,
  shown: string[],
  keep: Regions,
) {
  const { dropped, added } = selectionChange(selection, shown, keep)
  return dropped === 0 && added === 0
}

/**
 * "Actions apply to: Shown / All". On Shown, row 2's actions, Trim and the
 * sort rank reach S ∩ F; on All, the whole selection. It never reaches the
 * Scope, which always carries the whole selection.
 */
export type ActionLimit = "shown" | "all"

export const ACTION_LIMITS = ["shown", "all"] as const

export function actionTargets(
  selection: ReadonlySet<string>,
  shown: string[],
  limit: ActionLimit,
): Set<string> {
  if (limit === "all") return new Set(selection)
  return new Set(regionsOf(selection, shown).both)
}

export const hiddenSelection = (
  selection: ReadonlySet<string>,
  shown: string[],
) => new Set(regionsOf(selection, shown).hidden)

/** What a bulk confirmation says about the Hidden selection. */
export function hiddenSelectionNote(hiddenCount: number, limit: ActionLimit) {
  if (hiddenCount === 0) return ""
  const one = hiddenCount === 1
  if (limit === "all") {
    return `${hiddenCount} of them ${one ? "is" : "are"} hidden by filters.`
  }
  return `${hiddenCount} selected Channel${one ? "" : "s"} hidden by filters ${one ? "is" : "are"} not affected.`
}
