/**
 * One click on a Channel's selection control, plain or shift.
 *
 * A plain click toggles the clicked Channel. A shift-click sets every Channel
 * from the anchor to the clicked one, both ends included, to the state the
 * clicked Channel is moving to, so the same gesture selects a run or deselects
 * one. `order` is the grid as it is on screen now; an anchor missing from it
 * makes a shift-click a plain click, so a run never reaches a Channel the user
 * cannot see. Channels outside the run are untouched, and the clicked Channel
 * always becomes the new anchor.
 */
export function rangeSelect({
  selection,
  order,
  anchor,
  clicked,
  shift,
}: {
  selection: ReadonlySet<string>
  order: readonly string[]
  anchor: string | null
  clicked: string
  shift: boolean
}): { selection: Set<string>; anchor: string } {
  const select = !selection.has(clicked)
  const from = shift && anchor !== null ? order.indexOf(anchor) : -1
  const to = order.indexOf(clicked)
  const run =
    from === -1 || to === -1
      ? [clicked]
      : order.slice(Math.min(from, to), Math.max(from, to) + 1)

  const next = new Set(selection)
  for (const name of run) {
    if (select) next.add(name)
    else next.delete(name)
  }
  return { selection: next, anchor: clicked }
}
