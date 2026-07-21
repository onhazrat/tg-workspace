import { franc } from "franc-min"
import langs from "langs"
import type { Channel, Post } from "../types"

/**
 * Number of posts `detectLanguageFromPosts` actually samples. Callers should
 * fetch no more than this — anything beyond it is discarded.
 */
export const LANGUAGE_DETECTION_SAMPLE_SIZE = 20

/**
 * How far back background detection looks for a sample. Detection only needs
 * `LANGUAGE_DETECTION_SAMPLE_SIZE` recent posts; scanning a channel's whole
 * history to find them is what made this path expensive.
 */
export const LANGUAGE_DETECTION_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Channels still worth attempting background language detection on.
 *
 * `attempted` holds the names already tried this session. Detection is
 * best-effort: a channel whose sample was too short or whose language `franc`
 * could not determine returns `undefined`, and re-running would produce the
 * same `undefined` against the same posts. Without this guard such channels
 * stay in the "no language" set forever and are rescanned on every render.
 */
export function selectChannelsForLanguageDetection(
  channels: Channel[],
  attempted: ReadonlySet<string>,
): Channel[] {
  return channels.filter(
    (c) => !c.language && !c.isUnavailableOnWebView && !attempted.has(c.name),
  )
}

export function detectLanguageFromPosts(posts: Post[]): string | undefined {
  if (!posts || posts.length === 0) return undefined

  // Concatenate text from the latest posts (up to 20) to get a good sample
  const sampleText = posts
    .slice(0, LANGUAGE_DETECTION_SAMPLE_SIZE)
    .map((p) => p.text)
    .filter((t) => t && t.trim().length > 0)
    .join(" ")

  if (sampleText.length < 20) return undefined // Not enough text to reliably detect

  const langCode3 = franc(sampleText, { minLength: 10 })

  if (langCode3 === "und") return undefined // Undetermined

  // Convert 3-letter code to human-readable name
  const langInfo = langs.where("3", langCode3)

  if (langInfo?.name) {
    return langInfo.name
  }

  return langCode3 // Fallback to the 3-letter code if name not found
}
