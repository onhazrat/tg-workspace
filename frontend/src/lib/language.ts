import { franc } from "franc-min"
import langs from "langs"
import type { Post } from "../types"

export function detectLanguageFromPosts(posts: Post[]): string | undefined {
  if (!posts || posts.length === 0) return undefined

  // Concatenate text from the latest posts (up to 20) to get a good sample
  const sampleText = posts
    .slice(0, 20)
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
