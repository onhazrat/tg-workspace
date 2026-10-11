/**
 * Which Post a Citation names, and where the card gets it from (SUMTAB-04).
 *
 * The live lookup first, so the card shows today's views and edits; then the
 * snapshot the Summary stored when it was made, for a Post since deleted or
 * aged out; then nothing. Handles compare case-insensitively, because the AI
 * writes a handle however it likes and the lookup answers with the stored one.
 */
import type { ScopedPostRef } from "@/client"
import type { Post } from "@/types"

export interface CitedPost {
  channelName: string
  postId: number
  post: Post | null
  source: "live" | "snapshot" | "missing"
  /** Covered Posts are on record and this Post is not one of them. */
  outsideScope: boolean
}

export interface CitedPostSources {
  /** What the batch Post lookup answered for the Summary's Citations. */
  live: Post[]
  /** `Summary.citedPosts`, keyed `channel-id` as the AI wrote the handle. */
  snapshot: Record<string, Post> | undefined
  /** The frozen Scope's Post refs; null or absent when none were recorded. */
  covered: ScopedPostRef[] | null | undefined
}

const refKey = (channelName: string, postId: number) =>
  `${channelName.toLowerCase()}#${postId}`

/** Resolve Citations against one Summary's sources. */
export function citedPostResolver({
  live,
  snapshot,
  covered,
}: CitedPostSources): (channelName: string, postId: number) => CitedPost {
  const liveByKey = new Map(live.map((p) => [refKey(p.channelName, p.id), p]))
  const coveredKeys =
    covered && new Set(covered.map((r) => refKey(r.channelName, r.postId)))
  return (channelName, postId) => {
    const key = refKey(channelName, postId)
    const livePost = liveByKey.get(key)
    const stored = snapshot?.[`${channelName}-${postId}`]
    return {
      channelName,
      postId,
      post: livePost ?? stored ?? null,
      source: livePost ? "live" : stored ? "snapshot" : "missing",
      outsideScope: !!coveredKeys && !coveredKeys.has(key),
    }
  }
}
