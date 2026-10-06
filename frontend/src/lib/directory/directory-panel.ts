/**
 * The Directory detail panel's pure rules (DIR-03).
 *
 * A sample's Links carry no position in its text, so the panel renders the
 * text through the Posts tab's renderer, which finds the mentions and
 * addresses it shows, and lists the Links it does not show under the Post.
 */
import type { DirectorySampleLinkResponse } from "@/client"
import type { DirectoryFilter } from "@/lib/directory/directory-filter"
import { atoms } from "@/lib/filter-tree"

/** Past this many characters, or six lines, a Post is clamped until "Read more". */
const LONG_POST_CHARS = 280
const LONG_POST_LINES = 6

/** A caption-less media Post is stored with a placeholder such as `[photo]`. */
const MEDIA_PLACEHOLDER =
  /^\[(photo|video|voice|audio|document|poll|sticker|photo album)\]$/i

const bare = (url: string) =>
  url
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "")
    .toLowerCase()

/** The Links `text` does not show as a mention or an address, each once. */
export function hiddenLinks(
  text: string,
  links: DirectorySampleLinkResponse[],
): DirectorySampleLinkResponse[] {
  const words = text.toLowerCase()
  const seen = new Set<string>()
  return links.filter((link) => {
    const shown =
      words.includes(bare(link.url)) ||
      words.includes(`@${link.channel.toLowerCase()}`)
    if (shown || seen.has(link.url)) return false
    seen.add(link.url)
    return true
  })
}

/** A Post with no words of its own. */
export const isMediaOnly = (text: string) =>
  text.trim() === "" || MEDIA_PLACEHOLDER.test(text.trim())

export const isLongPost = (text: string) =>
  text.length > LONG_POST_CHARS || text.split("\n").length > LONG_POST_LINES

/**
 * The window of the filter's "Cited by your channels" Condition, which "Why
 * it's here" counts in so it lists what the sort and the Condition count;
 * `null` for every Post.
 */
export function mineWindow(filter: DirectoryFilter | undefined): number | null {
  if (!filter) return null
  for (const atom of atoms(filter)) {
    if (atom.cond.type === "mine") return atom.cond.days ?? null
  }
  return null
}
