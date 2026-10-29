/**
 * Tag use (ADR-042, TGU-02): every list of Tags on a tab is ordered by that
 * tab's Tag uses, highest first, then by how many of the tab's Channels carry
 * the Tag, then by name. The server keeps the uses and their decayed score;
 * this module only orders by it and words the rename and delete warnings.
 */
import { sameTag } from "@/lib/directory/directory-tags"
import { atoms, type BaseCond, type FilterNode } from "@/lib/filter-tree"

/** The tabs that keep their own Tag uses. */
export type TagTab = "channels" | "directory" | "requests"

/** Highest Tag use score first, then most channels, then by name. */
export function byTagUse<T>(
  items: readonly T[],
  score: (name: string) => number,
  name: (item: T) => string,
  count: (item: T) => number,
): T[] {
  return [...items].sort(
    (a, b) =>
      score(name(b)) - score(name(a)) ||
      count(b) - count(a) ||
      name(a).localeCompare(name(b)),
  )
}

type CountedTag = { name: string; channels: number }

/** What renaming `from` onto another Tag's name would merge; undefined when
 * `to` is no other Tag's name, a change of case included. */
export function mergeText(
  tags: readonly CountedTag[],
  from: string,
  to: string,
): string | undefined {
  if (sameTag(from, to)) return undefined
  const target = tags.find((t) => sameTag(t.name, to))
  if (!target) return undefined
  const n = tags.find((t) => sameTag(t.name, from))?.channels ?? 0
  return `"${target.name}" is already a Tag, on ${target.channels} channels. Renaming "${from}" to it merges the two: its ${n} channels get "${target.name}", and they can't be split apart again.`
}

/** The delete confirmation: how many Channels, followed or not, lose the Tag. */
export const deleteText = (name: string, channels: number) =>
  `"${name}" is on ${channels} channel${channels === 1 ? "" : "s"}, followed or not; deleting it takes it off every one.`

const tagValues = <C extends BaseCond>(filter: FilterNode<C>) =>
  atoms(filter).flatMap(({ cond }) =>
    cond.type === "tag" && "value" in cond ? [String(cond.value)] : [],
  )

/** The Tag values `after` names that `before` did not: the Tags a filter
 * change used, wherever the change came from. */
export function newTagValues<C extends BaseCond>(
  before: FilterNode<C>,
  after: FilterNode<C>,
): string[] {
  const had = new Set(tagValues(before))
  return tagValues(after).filter((value) => !had.has(value))
}
