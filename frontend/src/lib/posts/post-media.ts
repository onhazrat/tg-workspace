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
 * The media filter: a set of kinds (PFB-01). Empty is any media; otherwise a
 * Post matching any one kind is kept, so ticking more widens the feed. It was a
 * single value whose `"all"` meant what the empty set means now;
 * `parseMediaFilterValue` reads that old spelling out of storage.
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

const MEDIA_KINDS = new Set<string>(
  MEDIA_KIND_OPTIONS.map((option) => option.value),
)

export function isMediaKind(value: unknown): value is MediaKind {
  return typeof value === "string" && MEDIA_KINDS.has(value)
}

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

function matchesMediaKind(post: Post, kind: MediaKind): boolean {
  const kinds = getPostMediaKinds(post)
  const hasMedia = kinds.length > 0

  if (kind === "text_only") return !hasMedia

  if (kind === "media_only") {
    if (!hasMedia) return false
    return isMediaOnlyPost(post)
  }

  if (kind === "photo") return postHasMediaKind(post, "photo")
  if (kind === "video") return postHasMediaKind(post, "video")
  if (kind === "link_preview") return postHasMediaKind(post, "link_preview")
  return (
    postHasMediaKind(post, "grouped") ||
    (post.media?.groupedCount != null && post.media.groupedCount > 1)
  )
}

/** Keep in sync with `_media_clause` in backend/app/services/post_filters.py. */
export function matchesMediaFilter(
  post: Post,
  filter: MediaFilterValue,
): boolean {
  if (filter.length === 0) return true
  return filter.some((kind) => matchesMediaKind(post, kind))
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

/**
 * The stored media filter, read into the set shape.
 *
 * Stored as a JSON array since PFB-01. A value written by the previous bundle
 * is a bare string, `"all"` or one kind, and is read as `[]` or `[kind]`; the
 * hook writes the set back, so the old spelling is read exactly once. Anything
 * unreadable is any media, as it always was.
 */
export function parseMediaFilterValue(raw: string | null): MediaFilterValue {
  if (!raw || raw === "all") return []
  if (isMediaKind(raw)) return [raw]
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter(isMediaKind))]
  } catch {
    return []
  }
}
