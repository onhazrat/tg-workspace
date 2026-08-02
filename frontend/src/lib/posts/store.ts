import { api } from "@/api"
import { singleFlight } from "@/lib/singleFlight"
import type { Post } from "@/types"

/**
 * Reads and writes for the `Post` aggregate.
 *
 * Bulk post reading left the browser in A1 — `api.getPostsFeed` serves the feed,
 * the prompt scope is assembled server-side, and `computeScopedPosts` runs in
 * SQL. What survives here is the narrow-lookup path: resolving *specific* posts
 * by natural key, which citations and RAG context assembly need.
 *
 * **Suppress, not invalidate**, as with every family except logs. The feed is
 * keyed on its scope (`queryKeys.postsFeed`) and refetched by the components
 * that own it; a bulk upsert during sync must not invalidate every scope.
 */

/** The slice of `api` used here, injectable as a test seam (see `ChannelsApi`). */
export type PostsApi = Pick<typeof api, "lookupPosts" | "bulkUpsertPosts">

/** Must not exceed MAX_POST_LOOKUP_BATCH in backend/app/services/posts.py. */
const POST_LOOKUP_BATCH = 200

/**
 * Resolve specific posts by natural key, batched into one request per 200.
 *
 * Replaces a much older `getPost`, which fetched a channel's entire history to
 * return a single row — and was called in a loop by RAG context assembly and
 * once per citation hover.
 *
 * `singleFlight` is keyed on the *sorted* ref list, so the same set requested
 * concurrently in a different order still collapses to one request. Citation
 * hovers on a rendered summary are exactly that shape.
 */
export async function lookupPosts(
  refs: { channelName: string; postId: number }[],
  client: PostsApi = api,
): Promise<Post[]> {
  // Not load-bearing for correctness — the loop below issues nothing for zero
  // refs either. This only avoids registering a de-dup key per empty render.
  if (refs.length === 0) return []
  const key = `posts:lookup:${refs
    .map((r) => `${r.channelName}#${r.postId}`)
    .sort()
    .join(",")}`
  return singleFlight(key, async () => {
    const batches: Post[][] = []
    for (let i = 0; i < refs.length; i += POST_LOOKUP_BATCH) {
      batches.push(
        await client.lookupPosts(refs.slice(i, i + POST_LOOKUP_BATCH)),
      )
    }
    return batches.flat()
  })
}

/**
 * One post by natural key.
 *
 * Returns `undefined` when the post is not there, which is what
 * `CitationHover` renders as "unavailable". It used to fall back to the
 * IndexedDB mirror; with the mirror retired, a miss and a failure are both
 * simply "no post".
 */
export async function getPost(
  channelName: string,
  id: number,
  client: PostsApi = api,
): Promise<Post | undefined> {
  const [match] = await lookupPosts([{ channelName, postId: id }], client)
  return match
}

export async function bulkUpsertPosts(
  posts: Post[],
  client: PostsApi = api,
): Promise<void> {
  await client.bulkUpsertPosts(posts)
}
