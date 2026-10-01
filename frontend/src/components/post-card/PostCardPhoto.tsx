import { useState } from "react"
import { GALLERY_CAPTION_ATTR, PhotoViewerDialog } from "./PhotoViewer"
import { usePostThumbSrc } from "./PostCardMedia"

/**
 * The card's photo, opening the viewer on click.
 *
 * `w-full max-h-80 object-contain` once forced the element box to the full card
 * width and letterboxed the picture inside it, so `bg-app-muted` painted the
 * leftover: 813px of dead band on an 800x427 photo, 1233px on a 180x320 one —
 * 58% to 87% of the row. Sizing to the intrinsic aspect instead (`max-w-full`
 * + `max-h-80`, centred) makes the box *be* the picture, so there is no
 * leftover to paint and `object-contain` becomes unnecessary.
 */
export function PostCardPhoto({
  thumbApiPath,
  caption,
  compact = false,
}: {
  thumbApiPath: string
  /** Named in the viewer: the Channel's title. */
  caption: string
  /** A compact card caps the photo at 10rem rather than 20rem. */
  compact?: boolean
}) {
  const [src, setSrc] = usePostThumbSrc(thumbApiPath)
  const [open, setOpen] = useState(false)
  if (!src) return null
  return (
    <>
      <button
        type="button"
        aria-label="View image larger"
        data-shortcut="p"
        className="block max-w-full cursor-zoom-in"
        onClick={() => setOpen(true)}
      >
        <img
          src={src}
          alt=""
          data-testid="post-card-thumb"
          {...{ [GALLERY_CAPTION_ATTR]: caption }}
          className={`block max-w-full ${compact ? "max-h-40" : "max-h-80"} rounded-lg border border-app-ink/10 bg-app-muted`}
          loading="lazy"
          onError={() => setSrc(null)}
        />
      </button>
      <PhotoViewerDialog start={src} open={open} onOpenChange={setOpen} />
    </>
  )
}
