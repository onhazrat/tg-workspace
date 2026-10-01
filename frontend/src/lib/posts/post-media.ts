import { formatCount } from "@/lib/format-count"
import type { Post, PostMediaKind } from "@/types"

/** One media kind a Post can be filtered on. Mirrors `MediaKind` server-side. */
export type MediaKind =
  | "text_only"
  | "media_only"
  | "photo"
  | "video"
  | "link_preview"
  | "grouped"

/**
 * A frozen Scope's media filter from before PTR-03, read-only: a set of
 * kinds, empty for any. A live one is the Post filter's media Conditions,
 * which only the server evaluates.
 */
export type MediaFilterValue = MediaKind[]

export const MEDIA_KIND_OPTIONS: {
  label: string
  value: MediaKind
}[] = [
  { label: "Text-only", value: "text_only" },
  { label: "Media-only", value: "media_only" },
  { label: "Photo", value: "photo" },
  { label: "Video", value: "video" },
  { label: "Links", value: "link_preview" },
  { label: "Grouped", value: "grouped" },
]

export function getPostMediaKinds(post: Post): PostMediaKind[] {
  return post.media?.kinds ?? []
}

export function hasPostMedia(post: Post): boolean {
  return getPostMediaKinds(post).length > 0
}

function formatDurationLabel(durationSec: number): string {
  const minutes = Math.floor(durationSec / 60)
  const seconds = durationSec % 60
  if (minutes <= 0) return `0:${String(seconds).padStart(2, "0")}`
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

/** Structured media hints for prompts and embedding text (excludes reactions). */
export function formatPostMediaHints(post: Post): string {
  const media = post.media
  if (!media?.kinds?.length) return ""

  const parts: string[] = [`Media: ${media.kinds.join(", ")}`]

  if (media.durationSec != null && media.durationSec > 0) {
    parts.push(`Duration: ${formatDurationLabel(media.durationSec)}`)
  }
  if (post.viewsCount != null) {
    parts.push(`Views: ${formatCount(post.viewsCount)}`)
  }
  if (media.groupedCount != null && media.groupedCount > 1) {
    parts.push(`Album: ${media.groupedCount} items`)
  }

  const preview = media.linkPreview
  if (preview) {
    const previewText = [preview.title, preview.description]
      .filter(Boolean)
      .join(" — ")
    if (previewText) {
      const siteSuffix = preview.siteName ? ` (${preview.siteName})` : ""
      parts.push(`Link preview: ${previewText}${siteSuffix}`)
    }
  }

  return parts.join(" | ")
}

/** Text payload for vector embedding (richer than raw placeholder tokens). */
export function getPostEmbeddingText(post: Post): string {
  const hints = formatPostMediaHints(post)
  if (!hints) return post.text
  return `${hints}\n${post.text}`
}

export function getMediaKindLabel(kind: PostMediaKind): string {
  switch (kind) {
    case "photo":
      return "Photo"
    case "video":
      return "Video"
    case "voice":
      return "Voice"
    case "audio":
      return "Audio"
    case "document":
      return "Document"
    case "poll":
      return "Poll"
    case "sticker":
      return "Sticker"
    case "link_preview":
      return "Link"
    case "grouped":
      return "Album"
    default:
      return kind
  }
}
