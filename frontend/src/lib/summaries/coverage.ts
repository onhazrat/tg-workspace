/**
 * Which Channels a Summary drew on and how much of each it used (SUMTAB-06).
 *
 * Derived in the browser from what the tab already has: the Scope's Channels,
 * the Cited Posts, and the frozen Scope's Post refs. Channels compare
 * case-insensitively, because the AI writes a handle however it likes.
 */
import type { ScopedPostRef } from "@/client"
import { citationKey } from "@/lib/citations/find-citation"
import type { CitedPost } from "./cited-posts"

export interface CoverageRow {
  channelName: string
  /** Its distinct Cited Posts, in first-Citation order. */
  cited: CitedPost[]
  /** Its Covered Posts; null when the Summary recorded none. */
  covered: ScopedPostRef[] | null
  /** Cited, but not one of the Scope's Channels. */
  outsideScope: boolean
}

/** The wall's rows: most Cited Posts first, Covered Posts breaking ties. */
export function coverageRows(
  scopeChannels: string[],
  cited: CitedPost[],
  covered: ScopedPostRef[] | null | undefined,
): CoverageRow[] {
  const rows = new Map<string, CoverageRow>()
  // With no Scope on record nothing can be outside it.
  const row = (
    channelName: string,
    outsideScope = scopeChannels.length > 0,
  ) => {
    const key = channelName.toLowerCase()
    let r = rows.get(key)
    if (!r) {
      r = { channelName, cited: [], covered: covered ? [] : null, outsideScope }
      rows.set(key, r)
    }
    return r
  }
  for (const name of scopeChannels) row(name, false)
  const seen = new Set<string>()
  for (const c of cited) {
    const key = citationKey(c.channelName, c.postId)
    if (seen.has(key)) continue
    seen.add(key)
    row(c.channelName).cited.push(c)
  }
  for (const ref of covered ?? [])
    row(ref.channelName, false).covered?.push(ref)
  return [...rows.values()].sort(
    (a, b) =>
      b.cited.length - a.cited.length ||
      (b.covered?.length ?? 0) - (a.covered?.length ?? 0),
  )
}
