/**
 * Reading Telegram's subscriber counts, which reach us as display strings.
 *
 * `t.me` renders the counter as human text — `"573"`, `"12.5K"`, `"1.2M"`,
 * `"8 214"` — and both `Channel.subscribers` and `DiscoveryProbe.subscribers`
 * store that string verbatim, because the page never offers an exact figure
 * above roughly 10K. Anything that ranks by size therefore has to re-derive a
 * magnitude here, and the result is an approximation by construction: `"12.5K"`
 * is only known to be somewhere in [12450, 12550).
 */

/**
 * A number, optionally with a `K`/`M` magnitude suffix.
 *
 * The digit run tolerates the space and comma separators Telegram uses at four
 * digits and up (`"8 214"`), which are stripped before parsing.
 *
 * `(?![a-z])` is the load-bearing part: without it any word starting with m or k
 * directly after the number reads as a magnitude, so a count that arrives with
 * its label attached — `"204 members"` — becomes 204 million. Requiring the
 * suffix to end its word keeps `"12.5K"` and `"12.5K subscribers"` working while
 * rejecting the label.
 */
const SUBSCRIBER_PATTERN = /(\d[\d\s,]*(?:\.\d+)?)\s*([KM](?![a-z]))?/i

/**
 * The count as a number, or `null` when there is no count to compare.
 *
 * `null` rather than the more convenient `0` because "we never learned this
 * channel's size" and "this channel has no subscribers" have to be allowed to
 * sort differently. Collapsing them would let an unprobed handle rank as the
 * smallest channel in a report, which reads as a fact when it is the absence of
 * one.
 *
 * Only ASCII digits are recognised. Telegram renders the counter in ASCII
 * whatever the channel's language, so a Persian or Arabic channel still yields
 * `"12.5K"`.
 */
export function parseSubscriberCount(
  raw: string | null | undefined,
): number | null {
  if (!raw) return null
  const match = SUBSCRIBER_PATTERN.exec(raw)
  if (!match) return null
  const value = Number.parseFloat(match[1].replace(/[\s,]/g, ""))
  if (!Number.isFinite(value)) return null
  const suffix = match[2]?.toUpperCase()
  if (suffix === "M") return value * 1_000_000
  if (suffix === "K") return value * 1_000
  return value
}
