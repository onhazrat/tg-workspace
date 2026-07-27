import { countOf } from "@/lib/plural"

/**
 * Shaping for the tag preview table.
 *
 * On an unchanged run the table rendered every selected channel with "No
 * changes" in the Action column — 50 rows of nothing, with the one or two rows
 * that mattered buried among them, and no way to tell a proposed tag that is new
 * from one the channel already has.
 */

export type TagPreviewRow = {
  channel: string
  currentTags: string[]
  proposed: string[]
  toApply: string[]
}

export type TagPreviewMode = "add" | "remove"

/** Rows that will change something, and rows that will not. */
export function partitionPreviewRows(rows: TagPreviewRow[]): {
  changed: TagPreviewRow[]
  unchanged: TagPreviewRow[]
} {
  const changed: TagPreviewRow[] = []
  const unchanged: TagPreviewRow[] = []
  for (const row of rows) {
    ;(row.toApply.length > 0 ? changed : unchanged).push(row)
  }
  return { changed, unchanged }
}

/** `Show 47 unchanged channels` / `Hide unchanged`. */
export function unchangedToggleLabel(
  unchangedCount: number,
  shown: boolean,
): string {
  if (shown) return "Hide unchanged"
  return `Show ${countOf(unchangedCount, "unchanged channel")}`
}

export type ProposedTagState = "adding" | "removing" | "unchanged"

/**
 * How each proposed tag relates to what the channel already has.
 *
 * In `add` mode a tag the channel lacks is being added, and one it already has
 * is a no-op. In `remove` mode it is the reverse: a tag the channel has will be
 * removed, and one it lacks was never there. Comparison is case-insensitive
 * because that is how `toApply` is computed upstream — the highlight has to
 * agree with the action, or it points at the wrong rows.
 */
export function proposedTagState(
  tag: string,
  currentTags: string[],
  mode: TagPreviewMode,
): ProposedTagState {
  const held = currentTags.some(
    (current) => current.toLowerCase() === tag.toLowerCase(),
  )
  if (mode === "add") return held ? "unchanged" : "adding"
  return held ? "removing" : "unchanged"
}
