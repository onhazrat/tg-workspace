/**
 * `SummaryView`'s decisions, so they can be tested without its providers.
 * `SummaryView` renders them.
 */
import { isPendingSummary } from "@/constants"
import type { Summary, SummaryListItem } from "@/types"

/** Which Summary is open, what its body is, and whether it is being made. */
export function summaryViewState(input: {
  history: SummaryListItem[]
  currentSummaryId: string | null
  detail: Summary | null | undefined
  streamed: string | null
  regenerating: Set<string>
  summarizing: boolean
}) {
  /*
   * Prefer the list row, fall back to the detail fetch.
   *
   * Reading only from `summariesHistory` made opening a summary from History
   * depend on that list happening to be loaded and to contain the row — which
   * is not something History guarantees any more, since it lists artifacts
   * through `/data/artifacts` rather than through the summaries query. The
   * detail fetch is keyed on the id in the URL, so it always has the answer.
   */
  const currentSummary =
    input.history.find((s) => s.id === input.currentSummaryId) ?? input.detail
  return {
    currentSummary,
    /*
     * The body: live stream first, saved text second.
     *
     * `streamed` is `AIContext`'s streaming buffer — only ever set by
     * generating or pasting. Opening a saved summary used to fill it from the
     * restore path in `App.tsx`; deleting that path left this view rendering
     * nothing for every artifact opened from History, which is exactly what it
     * looked like. Falling back to the stored text means the view works from
     * the URL alone.
     */
    summaryBody: input.streamed ?? input.detail?.text ?? null,
    // A Generate files its item as `pending` before asking the model; while
    // that run is live the item is generating, and offering a paste box
    // would invite a response the run then overwrites.
    isPending: currentSummary
      ? isPendingSummary(currentSummary) &&
        !input.regenerating.has(currentSummary.id)
      : false,
    running:
      input.summarizing ||
      (currentSummary ? input.regenerating.has(currentSummary.id) : false),
  }
}
