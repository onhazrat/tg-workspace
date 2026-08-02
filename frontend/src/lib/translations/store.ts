import { api } from "@/api"
import { singleFlight } from "@/lib/singleFlight"
import type { PostTranslation } from "@/types"

/**
 * Reads and writes for the `PostTranslation` aggregate.
 *
 * ## The etag on this resource was actively harmful
 *
 * `getTranslation` used to be a **full-table download per read**, gated on a
 * resource etag — and because `saveTranslation` bumped that etag, every save
 * forced the next read to re-download every translation in the database. It is
 * a single-row request now, which is why this family needs neither the etag nor
 * an invalidation: nothing caches a list to go stale.
 *
 * `singleFlight` stays because a post can be rendered in several places at once
 * (feed, citation hover, summary body) and each asks for the same translation.
 */

/** The slice of `api` used here, injectable as a test seam (see `ChannelsApi`). */
export type TranslationsApi = Pick<
  typeof api,
  "getTranslation" | "upsertTranslations"
>

export async function getTranslation(
  channelName: string,
  postId: number,
  language: string,
  client: TranslationsApi = api,
): Promise<PostTranslation | undefined> {
  const key = `translation:${channelName}#${postId}#${language}`
  return singleFlight(key, async () => {
    const remote = await client.getTranslation(channelName, postId, language)
    // A confirmed absence stays an absence. The IndexedDB fall-through this
    // replaces could answer a "not translated yet" with a stale row.
    return remote ?? undefined
  })
}

export async function saveTranslation(
  translation: PostTranslation,
  client: TranslationsApi = api,
): Promise<void> {
  await client.upsertTranslations([translation])
}
