/**
 * The rules every Artifact run follows, whichever kind it produces (Summary,
 * Chat, Tag run). No React, so they can be tested directly; the contexts keep
 * the state and the toasts.
 */
import type { PostScopeQuery, PromptScope } from "@/api/data"
import {
  meaningQuery,
  type PostsView,
  respectsChannels,
} from "@/lib/posts/posts-view"

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
  view: Pick<PostsView, "keyword" | "ranking">,
) {
  return {
    postSearch: view.keyword || undefined,
    semanticSearchQuery: meaningQuery(view.ranking) || undefined,
    semanticSearchRespectsChannels: respectsChannels(view.ranking),
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

export type PromptPostsInput = { scope: PromptScope }

export interface PromptPosts {
  postCount: number
}

/**
 * How many posts the Posts tab selects now, for the "no Posts selected" check
 * before an Artifact opens. The count is the server's: the selected Posts in
 * the window (PTR-05). The prompt itself reads the Artifact's Covered Posts.
 */
export async function promptPosts(
  input: PromptPostsInput,
  channelNames: string[],
  countPosts: (q: PostScopeQuery) => Promise<Record<string, number>>,
): Promise<PromptPosts> {
  const counts = await countPosts({ channelNames, ...input.scope })
  return { postCount: Object.values(counts).reduce((sum, n) => sum + n, 0) }
}
