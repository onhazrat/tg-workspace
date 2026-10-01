import {
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

/** A badge per media kind; nothing for a text-only post. */
export function PostCardMedia({ post }: { post: Post }) {
  const kinds = getPostMediaKinds(post)
  if (kinds.length === 0) return null
  return (
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
    </div>
  )
}

/** The cached thumbnail as an object URL; null until loaded or after a failure. */
export function usePostThumbSrc(thumbApiPath: string) {
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

  return [src, setSrc] as const
}
