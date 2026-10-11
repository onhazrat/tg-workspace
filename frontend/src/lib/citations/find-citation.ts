/**
 * Find a Citation in the rendered report: scroll it into view and highlight it
 * briefly (SUMTAB-04). The photo strip's "Find in report" and Locate button
 * (SUMTAB-05) and the Channel posts sheet's Find (SUMTAB-06) all land here.
 *
 * A Find is usually pressed inside a dialog that is closing. Radix keeps the
 * dialog mounted through its exit animation and holds the page's scroll lock
 * (`data-scroll-locked` on the body) until it unmounts, and a scroll started
 * under that lock is swallowed. So the jump waits for both to be gone. The
 * wait is capped, so a dialog that never closes delays a Find rather than
 * losing it.
 */

/** The attribute every rendered Citation carries, valued `citationKey(...)`. */
export const CITATION_ATTR = "data-citation"
/** Set on a found Citation while it is highlighted. */
export const FOUND_ATTR = "data-citation-found"

/** One Post's key, the same however the AI spelled the handle. */
export const citationKey = (channelName: string, postId: number) =>
  `${channelName.toLowerCase()}#${postId}`

const NARROW = "(max-width: 767px)"
const POLL_MS = 16
const MAX_WAIT_MS = 2000

const dialogOpen = () =>
  document.body.hasAttribute("data-scroll-locked") ||
  document.querySelector('[role="dialog"], [role="alertdialog"]') !== null

async function untilNoDialog() {
  for (let waited = 0; dialogOpen() && waited < MAX_WAIT_MS; waited += POLL_MS)
    await new Promise((r) => setTimeout(r, POLL_MS))
}

/**
 * Scroll the Post's first Citation into view and highlight it; false when the
 * report does not cite the Post. Instant on a narrow screen, where a smooth
 * scroll over a long report is slow and easy to interrupt with a touch.
 */
export async function findCitation(
  channelName: string,
  postId: number,
  options: { narrow?: boolean; highlightMs?: number } = {},
): Promise<boolean> {
  await untilNoDialog()
  const el = document.querySelector<HTMLElement>(
    `[${CITATION_ATTR}="${CSS.escape(citationKey(channelName, postId))}"]`,
  )
  if (!el) return false
  const narrow = options.narrow ?? window.matchMedia?.(NARROW).matches ?? false
  el.scrollIntoView({
    behavior: narrow ? "instant" : "smooth",
    block: "center",
  })
  el.setAttribute(FOUND_ATTR, "")
  setTimeout(() => el.removeAttribute(FOUND_ATTR), options.highlightMs ?? 1600)
  return true
}
