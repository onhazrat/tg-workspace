/**
 * The rules every Artifact run follows, whichever kind it produces (Summary,
 * Chat, Tag run). No React, so they can be tested directly; the contexts keep
 * the state and the toasts.
 */
import { frozenWindow, type PostScopeQuery, type PromptScope } from "@/api/data"
import type { FrozenScope } from "@/client"
import { formatPostsForPrompt } from "@/lib/posts/post-view"
import type { Post } from "@/types"

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
 * Select by what the server froze, not by what the clock says now: the Artifact
 * and its prompt have to name the same two instants. No scope is the semantic
 * path, which carries its Posts rather than a window; no frozen Scope is a row
 * opened before AW-06.
 */
export function frozenScope(
  scope: PromptScope | undefined,
  frozen: FrozenScope | null | undefined,
): PromptScope | undefined {
  return scope && frozen ? { ...scope, window: frozenWindow(frozen) } : scope
}

/** The Posts-tab filters a submission records beside its Scope; empty ones are left out. */
export function searchFilterExtra(filters: {
  postSearch: string
  semanticSearchQuery: string
  semanticSearchRespectsChannels: boolean
}) {
  return {
    postSearch: filters.postSearch || undefined,
    semanticSearchQuery: filters.semanticSearchQuery || undefined,
    semanticSearchRespectsChannels: filters.semanticSearchRespectsChannels,
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

export type PromptPostsInput =
  | { posts: Post[]; scope?: undefined }
  | { posts?: undefined; scope: PromptScope }

export interface PromptPosts {
  /** Set on the server-assembly path: the backend builds the posts block. */
  scope?: PromptScope
  /** Set on the semantic/related path: the posts this browser holds. */
  posts?: Post[]
  postsText: string
  postCount: number
}

/**
 * The posts block a prompt is built from, and how many posts it covers.
 *
 * A server-eligible scope travels as the scope, so no posts cross the wire and
 * the count comes from the server; semantic or related results are formatted
 * here. `frozen` selects the counted window when the Scope is already frozen.
 */
export async function promptPosts(
  input: PromptPostsInput,
  channelNames: string[],
  countPosts: (q: PostScopeQuery) => Promise<Record<string, number>>,
  frozen?: FrozenScope | null,
): Promise<PromptPosts> {
  if (!input.scope)
    return {
      posts: input.posts,
      postsText: formatPostsForPrompt(input.posts),
      postCount: input.posts.length,
    }
  const scope = frozenScope(input.scope, frozen)
  const counts = await countPosts({ channelNames, ...scope })
  const postCount = Object.values(counts).reduce((sum, n) => sum + n, 0)
  return { scope, postsText: "", postCount }
}
