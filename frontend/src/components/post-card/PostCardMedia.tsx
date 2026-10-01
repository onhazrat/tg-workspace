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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog"
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
  const views = post.viewsCount
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

export function PostThumbImage({
  thumbApiPath,
  className = "max-w-full max-h-80 mx-auto rounded-lg border border-app-ink/10 bg-app-muted",
  frameClassName,
}: {
  thumbApiPath: string
  className?: string
  /** The click target around the picture, for a layout that stretches it. */
  frameClassName?: string
}) {
  const [src, setSrc] = usePostThumbSrc(thumbApiPath)

  if (!src) return null

  /*
   * `w-full max-h-80 object-contain` forced the element box to the full card
   * width and letterboxed the picture inside it, so `bg-app-muted` painted the
   * leftover: 813px of dead band on an 800x427 photo, 1233px on a 180x320 one —
   * 58% to 87% of the row. Sizing to the intrinsic aspect instead (`max-w-full`
   * + `max-h-80`, centred) makes the box *be* the picture, so there is no
   * leftover to paint and `object-contain` becomes unnecessary.
   */
  // Click opens the same picture as large as the viewport allows.
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="View image larger"
          className={`block max-w-full mx-auto cursor-zoom-in ${frameClassName ?? ""}`}
        >
          <img
            src={src}
            alt=""
            data-testid="post-card-thumb"
            className={className}
            loading="lazy"
            onError={() => setSrc(null)}
          />
        </button>
      </DialogTrigger>
      <DialogContent className="w-[96vw] h-[94vh] max-w-none sm:max-w-none border-0 bg-transparent p-0 shadow-none">
        <DialogTitle className="sr-only">Post image</DialogTitle>
        {/* A click on the picture closes it too, not only one outside it. */}
        <DialogClose asChild>
          <img
            src={src}
            alt=""
            data-testid="post-card-lightbox"
            className="w-full h-full object-contain cursor-zoom-out"
          />
        </DialogClose>
      </DialogContent>
    </Dialog>
  )
}
