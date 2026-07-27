import type { Post, PostMediaKind } from "@/types"

export type MediaFilterValue =
  | "all"
  | "text_only"
  | "media_only"
  | "photo"
  | "video"
  | "link_preview"
  | "grouped"

export const MEDIA_FILTER_OPTIONS: {
  label: string
  value: MediaFilterValue
}[] = [
  { label: "All", value: "all" },
  { label: "Text-only", value: "text_only" },
  { label: "Media-only", value: "media_only" },
  { label: "Photo", value: "photo" },
  { label: "Video", value: "video" },
  { label: "Links", value: "link_preview" },
  { label: "Grouped", value: "grouped" },
]

// Keep in sync with _MEDIA_ONLY_TEXT_RE in backend/app/services/post_filters.py.
const MEDIA_ONLY_TEXT_RE =
  /^\[(?:photo|video|voice|audio|document|poll|sticker|photo album)\]/i

export function getPostMediaKinds(post: Post): PostMediaKind[] {
  return post.media?.kinds ?? []
}

export function hasPostMedia(post: Post): boolean {
  return getPostMediaKinds(post).length > 0
}

export function isMediaOnlyPost(post: Post): boolean {
  if (post.media?.isMediaOnly) return true
  if (post.text === "[Media/No Text Content]") return hasPostMedia(post)
  return MEDIA_ONLY_TEXT_RE.test(post.text.trim())
}

export function postHasMediaKind(post: Post, kind: PostMediaKind): boolean {
  return getPostMediaKinds(post).includes(kind)
}

export function matchesMediaFilter(
  post: Post,
  filter: MediaFilterValue,
): boolean {
  if (filter === "all") return true

  const kinds = getPostMediaKinds(post)
  const hasMedia = kinds.length > 0

  if (filter === "text_only") return !hasMedia

  if (filter === "media_only") {
    if (!hasMedia) return false
    return isMediaOnlyPost(post)
  }

  if (filter === "photo") return postHasMediaKind(post, "photo")
  if (filter === "video") return postHasMediaKind(post, "video")
  if (filter === "link_preview") return postHasMediaKind(post, "link_preview")
  if (filter === "grouped") {
    return (
      postHasMediaKind(post, "grouped") ||
      (post.media?.groupedCount != null && post.media.groupedCount > 1)
    )
  }

  return true
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
  if (media.views) parts.push(`Views: ${media.views}`)
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

export function parseMediaFilterValue(raw: string | null): MediaFilterValue {
  const allowed = new Set<string>(
    MEDIA_FILTER_OPTIONS.map((option) => option.value),
  )
  if (raw && allowed.has(raw)) return raw as MediaFilterValue
  return "all"
}
