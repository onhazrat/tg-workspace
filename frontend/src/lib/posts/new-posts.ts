/**
 * New Posts wait behind a pill rather than appear under the reader (X-style).
 * A refetch that brings a Post in above the last one already shown would push
 * the Post being read down, or sideways in the Compact grid, so that Post is
 * held until the pill is clicked. Posts after the last one shown are a page
 * loading, and show at once.
 */
export function holdNewPosts<T>(
  posts: readonly T[],
  seen: ReadonlySet<string>,
  keyOf: (post: T) => string,
): { shown: T[]; held: T[] } {
  let last = -1
  posts.forEach((post, i) => {
    if (seen.has(keyOf(post))) last = i
  })
  const shown: T[] = []
  const held: T[] = []
  posts.forEach((post, i) => {
    ;(i < last && !seen.has(keyOf(post)) ? held : shown).push(post)
  })
  return { shown, held }
}
