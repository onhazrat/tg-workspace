/**
 * Minimal English pluralization, to retire the `channel(s)` hack.
 *
 * `43 selected channel(s)` reads as unfinished UI. Counts are always known at
 * render time here, so there is never a reason to hedge.
 */
export function pluralize(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return count === 1 ? singular : plural
}

/** `2 channels`, `1 channel`. */
export function countOf(
  count: number,
  singular: string,
  plural?: string,
): string {
  return `${count} ${pluralize(count, singular, plural)}`
}
