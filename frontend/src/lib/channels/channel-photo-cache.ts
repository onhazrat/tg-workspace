/**
 * Session-scoped cache that resolves a channel photo to a displayable `src`,
 * shared by every avatar in the app (Channels tab and per-post headers).
 *
 * Keyed by `channelId::photoUrl` so all avatars for the same channel reuse a
 * single fetch and a single object URL — a post feed with N posts across M
 * channels does at most M photo fetches, not N. Object URLs are intentionally
 * never revoked: they live for the session (bounded by channel count) so cards
 * can mount/unmount freely without re-fetching.
 */

import { api } from "@/api"

/** A `photoUrl` served by our own backend blob endpoint (needs auth fetch). */
function isCachedPhotoUrl(photoUrl?: string | null): boolean {
  return Boolean(photoUrl?.includes("/telegram/channel-photo/"))
}

const cache = new Map<string, Promise<string | null>>()

function cacheKey(
  channelId: string,
  photoUrl: string | null | undefined,
): string {
  return `${channelId}::${photoUrl ?? ""}`
}

async function resolve(
  channelId: string,
  photoUrl: string | null | undefined,
): Promise<string | null> {
  if (!photoUrl) return null
  if (isCachedPhotoUrl(photoUrl)) {
    const blob = await api.fetchChannelPhoto(channelId)
    return URL.createObjectURL(blob)
  }
  // External (already-public) URL: use it directly, no object URL needed.
  if (photoUrl.startsWith("http")) return photoUrl
  return null
}

/**
 * Resolve a channel's photo `src`, deduping concurrent and repeat requests.
 * Returns `null` when the channel has no usable photo.
 */
export function getChannelPhotoSrc(
  channelId: string,
  photoUrl: string | null | undefined,
): Promise<string | null> {
  const key = cacheKey(channelId, photoUrl)
  const existing = cache.get(key)
  if (existing) return existing

  const pending = resolve(channelId, photoUrl)
  cache.set(key, pending)
  // On failure, evict so a later mount can retry instead of caching the error.
  pending.catch(() => {
    if (cache.get(key) === pending) cache.delete(key)
  })
  return pending
}

/** Test-only: drop all cached entries. */
export function __resetChannelPhotoCache(): void {
  cache.clear()
}
