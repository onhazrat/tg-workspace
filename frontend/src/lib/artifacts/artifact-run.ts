/**
 * The rules every Artifact run follows, whichever kind it produces (Summary,
 * Chat, Tag run). No React, so they can be tested directly; the contexts keep
 * the state and the toasts.
 */
import type { QueryClient } from "@tanstack/react-query"

import {
  dataPostsCounts,
  type PostCountsResponse,
  type PostFilteredRequest,
} from "@/client"
import { meaningQuery, type PostsView, postsRead } from "@/lib/posts/posts-view"

/** What a run tells `withProvisionalRow` about the row it opened. */
export interface ProvisionalRow {
  /** The submission created this row; delete it unless the run completes. */
  opened: (id: string) => void
  /** The run wrote its result; the row stays. */
  keep: () => void
}

/**
 * Run `work`, deleting the row it opened unless it says to keep it.
 *
 * Submission creates the row before a token is spent (AW-05), so a run that
 * produces nothing has to take it back, or every failed generation litters
 * History with an empty Artifact that has a perfectly good Scope. Only the row
 * *this* run opened: a failure on a chat's ninth turn does not delete the eight
 * that worked. The delete's own failure is swallowed so it cannot mask `work`'s.
 */
export async function withProvisionalRow<T>(
  remove: (id: string) => Promise<unknown>,
  work: (row: ProvisionalRow) => Promise<T>,
): Promise<T> {
  let openedId: string | null = null
  try {
    return await work({
      opened: (id) => {
        openedId = id
      },
      keep: () => {
        openedId = null
      },
    })
  } finally {
    if (openedId) await remove(openedId).catch(() => {})
  }
}

/**
 * The Missing Post count as an Artifact stores it, beside the prompt it
 * describes (ADR-038): zero is never stored.
 */
export const withMissingPosts = (
  missingPosts: number,
): { missingPosts?: number } => (missingPosts > 0 ? { missingPosts } : {})

/** The Posts-tab searches a submission records beside its Scope; empty ones are left out. */
export function searchFilterExtra(
  view: Pick<PostsView, "keyword" | "ranking" | "respectsChannels">,
) {
  return {
    postSearch: view.keyword || undefined,
    semanticSearchQuery: meaningQuery(view.ranking) || undefined,
    semanticSearchRespectsChannels: view.respectsChannels,
  }
}

export const errorText = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback

/** Drain a model stream, reporting the text so far after every chunk. */
export async function readStream(
  stream: AsyncIterable<{ text: string }>,
  onText: (textSoFar: string) => void = () => {},
): Promise<{ text: string; lastChunk: unknown }> {
  let text = ""
  let lastChunk: unknown = null
  for await (const chunk of stream) {
    text += chunk.text || ""
    lastChunk = chunk
    onText(text)
  }
  return { text, lastChunk }
}

/**
 * How many Posts the Posts tab selects now, for the "no Posts selected" check
 * before an Artifact opens: the view's Scope counts read, the server's count
 * of the selected Posts in the window (PTR-05). Fetched with no stale time,
 * so a selection changed a moment ago is counted. The prompt itself reads the
 * Artifact's Covered Posts.
 */
export async function selectedPostCount(
  queryClient: QueryClient,
  view: PostsView,
  countPosts: (body: PostFilteredRequest) => Promise<PostCountsResponse> = (
    body,
  ) => dataPostsCounts({ body }),
): Promise<number> {
  const { queryKey, body } = postsRead(view, { kind: "scopeCounts" })
  const { selected } = await queryClient.fetchQuery({
    queryKey,
    queryFn: () => countPosts(body as PostFilteredRequest),
    staleTime: 0,
  })
  return Object.values(selected).reduce((sum, n) => sum + n, 0)
}
