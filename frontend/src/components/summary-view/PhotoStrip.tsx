import { LocateFixed } from "lucide-react"
import { useState } from "react"
import {
  GALLERY_ATTR,
  GALLERY_CAPTION_ATTR,
  type PhotoAction,
  PhotoViewerDialog,
} from "@/components/post-card/PhotoViewer"
import { usePostThumbSrc } from "@/components/post-card/PostCardPhoto"
import { findCitation } from "@/lib/citations/find-citation"
import type { CitedPost } from "@/lib/summaries/cited-posts"

const tileKey = (c: CitedPost) => `${c.channelName}_${c.postId}`

/**
 * The photos of a Summary's Cited Posts (SUMTAB-05), in the order the prose
 * first cites them and in its reading direction (`dir`), which the viewer's
 * swipes and arrows follow too. A tile opens the viewer over the strip's
 * photos alone, where "Find in report" closes it and then finds the Citation;
 * the corner Locate button finds it without opening anything.
 */
export function PhotoStrip({
  cited,
  loading,
  dir,
}: {
  /** The Cited Posts in first-Citation order, photo or not. */
  cited: CitedPost[]
  loading: boolean
  dir: string
}) {
  const [start, setStart] = useState<string | null>(null)
  const photos = cited.filter((c) => c.post?.media?.thumbApiPath)
  if (!photos.length)
    return (
      <p className="mb-4 text-xs text-app-ink/50">
        {loading ? "Loading the cited posts…" : "No photos in the cited posts"}
      </p>
    )
  const byKey = new Map(photos.map((c) => [tileKey(c), c]))
  const findInReport: PhotoAction = (photo, close) => {
    const c = byKey.get(photo.card?.dataset.postKey ?? "")
    return (
      c && (
        <button
          type="button"
          className="rounded-full bg-black/60 px-3 py-1 text-xs text-white hover:bg-black/80"
          onClick={() => {
            close()
            void findCitation(c.channelName, c.postId)
          }}
        >
          Find in report
        </button>
      )
    )
  }
  return (
    <div
      dir={dir}
      {...{ [GALLERY_ATTR]: "" }}
      className="mb-4 flex gap-2 overflow-x-auto pb-1"
    >
      {photos.map((c) => (
        <StripTile key={tileKey(c)} cited={c} onOpen={setStart} />
      ))}
      <PhotoViewerDialog
        start={start ?? ""}
        open={start !== null}
        onOpenChange={(open) => !open && setStart(null)}
        title="Cited photo"
        action={findInReport}
      />
    </div>
  )
}

function StripTile({
  cited,
  onOpen,
}: {
  cited: CitedPost
  onOpen: (src: string) => void
}) {
  const [src, setSrc] = usePostThumbSrc(cited.post?.media?.thumbApiPath ?? "")
  // Still loading, or the thumbnail is gone.
  if (!src) return null
  const label = `${cited.channelName} #${cited.postId}`
  return (
    <div data-post-key={tileKey(cited)} className="relative shrink-0">
      <button
        type="button"
        aria-label={`Photo from ${label}`}
        className="block cursor-zoom-in"
        onClick={() => onOpen(src)}
      >
        <img
          src={src}
          alt=""
          {...{ [GALLERY_CAPTION_ATTR]: label }}
          className="block h-24 max-w-48 rounded-lg border border-app-ink/10 bg-app-muted object-cover"
          onError={() => setSrc(null)}
        />
      </button>
      <button
        type="button"
        aria-label={`Locate ${label} in the report`}
        title="Find in report"
        className="absolute end-1 top-1 rounded-full bg-black/40 p-1 text-white opacity-70 hover:opacity-100"
        onClick={() => void findCitation(cited.channelName, cited.postId)}
      >
        <LocateFixed size={12} />
      </button>
    </div>
  )
}
