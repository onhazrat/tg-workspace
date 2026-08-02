import { api } from "@/api"
import { singleFlight } from "@/lib/singleFlight"
import type { Summary, SummaryListItem, TagRun, TagRunSummary } from "@/types"

/**
 * Reads and writes for the `Summary` and `TagRun` aggregates.
 *
 * ## Writes do not invalidate — same rule as channels, not logs
 *
 * `repository.ts` called `markResourceSynced("summaries")` after every write,
 * which stored the *new* etag so the next staleness check answered "fresh". A
 * summary write **suppressed** the refetch. Callers that want the history list
 * refreshed say so explicitly — `DataContext.loadHistory()` is
 * `useInvalidateSummaries()`, and `HistoryView` calls it after a delete.
 *
 * Adding a blanket invalidation here would refetch the whole history on every
 * autosave of the summary currently being streamed, which is once per token
 * batch.
 *
 * ## Why `singleFlight` survives here but not in the logs family
 *
 * `useSummariesQuery`/`useSummaryDetailQuery` get de-duplication from
 * react-query for free, but `listSummaries` also has two non-React callers —
 * `lib/commands/search-filters.ts` and `lib/data-transfer/entities/summary.ts` —
 * which react-query never sees. Dropping it goes with the infrastructure block
 * at the end of A3, once nothing outside a hook reads a summary.
 */

/** The slice of `api` used here, injectable as a test seam (see `ChannelsApi`). */
export type SummariesApi = Pick<
  typeof api,
  | "listSummaries"
  | "getSummary"
  | "upsertSummary"
  | "deleteSummary"
  | "listTagRuns"
  | "getTagRun"
  | "upsertTagRun"
  | "deleteTagRun"
>

/**
 * Metadata-only list. Use `getSummary` for citedPosts/promptText/chatMessages.
 *
 * `search` is passed to the server so prompt bodies stay searchable — they are
 * ~94% of what this endpoint used to return and are no longer shipped. That is
 * also why a search can never be answered locally: the column it matches on is
 * not here.
 */
export async function listSummaries(
  options: { search?: string } = {},
  client: SummariesApi = api,
): Promise<SummaryListItem[]> {
  const { search } = options
  return singleFlight(`summaries:${search ?? ""}`, () =>
    search ? client.listSummaries({ search }) : client.listSummaries(),
  )
}

/** One summary in full, including the heavy fields. */
export async function getSummary(
  id: string,
  client: SummariesApi = api,
): Promise<Summary | undefined> {
  return singleFlight(`summary:${id}`, () => client.getSummary(id))
}

export async function saveSummary(
  summary: Summary,
  client: SummariesApi = api,
): Promise<Summary> {
  return client.upsertSummary(summary.id, summary)
}

export async function deleteSummary(
  id: string,
  client: SummariesApi = api,
): Promise<void> {
  await client.deleteSummary(id)
}

/**
 * Metadata-only list; use `getTagRun` for prompt/response/suggestions.
 *
 * Returns `[]` rather than throwing, as it did before: the tag-run list is a
 * side panel, and a failure there must not take down the view hosting it.
 */
export async function listTagRuns(
  client: SummariesApi = api,
): Promise<TagRunSummary[]> {
  try {
    return await client.listTagRuns()
  } catch {
    return []
  }
}

/** One run in full, including the heavy prompt and response fields. */
export async function getTagRun(
  id: string,
  client: SummariesApi = api,
): Promise<TagRun | undefined> {
  return singleFlight(`tagRun:${id}`, async () => {
    try {
      return await client.getTagRun(id)
    } catch {
      return undefined
    }
  })
}

export async function upsertTagRun(
  run: TagRun,
  client: SummariesApi = api,
): Promise<TagRun> {
  return client.upsertTagRun(run.id, run)
}

export async function deleteTagRun(
  id: string,
  client: SummariesApi = api,
): Promise<void> {
  await client.deleteTagRun(id)
}
