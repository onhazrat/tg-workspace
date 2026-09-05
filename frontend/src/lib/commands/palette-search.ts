import {
  searchPostsForPalette,
  searchSummariesForPalette,
  semanticSearchPostsForPalette,
} from "@/lib/commands/search-filters"
import type {
  CommandContext,
  CommandDef,
  SearchResultsState,
} from "@/lib/commands/types"
import type { SummariesApi } from "@/lib/summaries/store"

/**
 * Runs the search an editor command requested and packages the results for
 * the search-results sub-view. Returns null for non-search commands.
 */
export async function buildSearchResultsState(
  command: CommandDef,
  ctx: CommandContext,
  rawQuery: string,
  summariesApi?: SummariesApi,
): Promise<SearchResultsState | null> {
  if (command.searchResultsKind === "posts") {
    const query = rawQuery.trim()
    const items =
      command.id === "semantic-search-posts"
        ? await semanticSearchPostsForPalette(ctx, query)
        : await searchPostsForPalette(ctx, query)
    return { kind: "posts", query, items, totalCount: items.length }
  }

  if (command.searchResultsKind === "summaries") {
    const query = rawQuery.trim()
    const items = await searchSummariesForPalette(ctx, query, summariesApi)
    return { kind: "summaries", query, items, totalCount: items.length }
  }

  return null
}
