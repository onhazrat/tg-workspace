import {
  Eye,
  Image,
  Layers,
  Link2,
  type LucideIcon,
  Music,
  Sticker,
  Video,
} from "lucide-react"
import { useEffect, useState } from "react"
import { api } from "@/api"
import { formatCount } from "@/lib/format-count"
import { getMediaKindLabel, getPostMediaKinds } from "@/lib/posts/post-media"
import type { Post, PostMediaKind } from "@/types"
import { Badge } from "../ui/badge"
import { mediaBadgeSuffix } from "./post-card-model"

const MEDIA_ICONS: Partial<Record<PostMediaKind, LucideIcon>> = {
  photo: Image,
  video: Video,
  link_preview: Link2,
  grouped: Layers,
  audio: Music,
  sticker: Sticker,
}

/** Media badges, the view count and the thumbnail; nothing when the post has none of them. */
export function PostCardMedia({ post }: { post: Post }) {
  const kinds = getPostMediaKinds(post)
  const views = post.media?.viewsCount
  const thumbApiPath = post.media?.thumbApiPath
  const hasBadges = kinds.length > 0 || views != null
  if (!hasBadges && !thumbApiPath) return null
  return (
    <div className="flex flex-col gap-3">
      {hasBadges && (
        <div className="flex flex-wrap items-center gap-2">
          {kinds.map((kind) => {
            const Icon = MEDIA_ICONS[kind]
            return (
              <Badge
                key={kind}
                variant="secondary"
                data-testid={`post-card-media-badge-${kind}`}
                className="gap-1 text-[10px] uppercase tracking-wider font-bold"
              >
                {Icon && <Icon size={10} />}
                {getMediaKindLabel(kind)}
                {mediaBadgeSuffix(kind, post)}
              </Badge>
            )
          })}
          {views != null && (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-app-ink/60">
              <Eye size={10} />
              {formatCount(views)}
            </span>
          )}
        </div>
      )}
      {thumbApiPath && <PostThumbImage thumbApiPath={thumbApiPath} />}
    </div>
  )
}

function PostThumbImage({ thumbApiPath }: { thumbApiPath: string }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let objectUrl: string | null = null
    setSrc(null)
    api
      .fetchPostThumb(thumbApiPath)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      })
      .catch(() => setSrc(null))
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [thumbApiPath])

  if (!src) return null

  /*
   * `w-full max-h-80 object-contain` forced the element box to the full card
   * width and letterboxed the picture inside it, so `bg-app-muted` painted the
   * leftover: 813px of dead band on an 800x427 photo, 1233px on a 180x320 one —
   * 58% to 87% of the row. Sizing to the intrinsic aspect instead (`max-w-full`
   * + `max-h-80`, centred) makes the box *be* the picture, so there is no
   * leftover to paint and `object-contain` becomes unnecessary.
   */
  return (
    <img
      src={src}
      alt=""
      data-testid="post-card-thumb"
      className="max-w-full max-h-80 mx-auto rounded-lg border border-app-ink/10 bg-app-muted"
      loading="lazy"
      onError={() => setSrc(null)}
    />
  )
}
