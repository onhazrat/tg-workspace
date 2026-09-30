/**
 * PROTOTYPE, throwaway: selection changes relative to what the filters show,
 * for S1-S3. S is the selection, F the channels the filters show. Every
 * operation keeps or drops each of three regions:
 *   hidden  S − F  selected, hidden by the filters
 *   both    S ∩ F  selected and shown
 *   fresh   F − S  shown, not selected
 * so the four asked for, and the rest, are one table.
 */
export type Regions = { hidden: boolean; both: boolean; fresh: boolean }

export type SelectionOp = {
  key: string
  label: string
  detail: string
  regions: Regions
}

export const SELECTION_OPS: SelectionOp[] = [
  {
    key: "add",
    label: "Add shown",
    detail: "Keep the selection, add every shown channel",
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
    detail: "Drop selected channels the filters hide",
    regions: { hidden: false, both: true, fresh: false },
  },
  {
    key: "invert",
    label: "Invert shown",
    detail: "Flip the shown channels, leave hidden ones as they are",
    regions: { hidden: true, both: false, fresh: true },
  },
  {
    key: "replace",
    label: "Select only shown",
    detail: "Exactly the shown channels, nothing else",
    regions: { hidden: false, both: true, fresh: true },
  },
]

export function regionsOf(selected: Set<string>, shown: string[]) {
  const shownSet = new Set(shown)
  const hidden = [...selected].filter((n) => !shownSet.has(n))
  const both = shown.filter((n) => selected.has(n))
  const fresh = shown.filter((n) => !selected.has(n))
  return { hidden, both, fresh }
}

export function applyRegions(
  selected: Set<string>,
  shown: string[],
  keep: Regions,
): Set<string> {
  const r = regionsOf(selected, shown)
  return new Set([
    ...(keep.hidden ? r.hidden : []),
    ...(keep.both ? r.both : []),
    ...(keep.fresh ? r.fresh : []),
  ])
}

export const sizeAfter = (
  selected: Set<string>,
  shown: string[],
  keep: Regions,
) => applyRegions(selected, shown, keep).size

/** Does applying `keep` leave the selection as it is? */
export function isNoop(selected: Set<string>, shown: string[], keep: Regions) {
  const r = regionsOf(selected, shown)
  return (
    (keep.hidden || r.hidden.length === 0) &&
    (keep.both || r.both.length === 0) &&
    (!keep.fresh || r.fresh.length === 0)
  )
}

/**
 * "Only shown" scope: the bulk actions and the count act on S ∩ F. The
 * hidden part of the selection is kept, not dropped, so turning the scope
 * off brings it back.
 */
export type SelectionScope = "all" | "shown"

export const actedOn = (
  selected: Set<string>,
  shown: string[],
  scope: SelectionScope,
) => (scope === "all" ? selected.size : regionsOf(selected, shown).both.length)
