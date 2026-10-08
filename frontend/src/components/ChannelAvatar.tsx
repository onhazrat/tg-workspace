import { ZoomIn } from "lucide-react"
import { useEffect, useState } from "react"

import {
  GALLERY_CAPTION_ATTR,
  PhotoViewerDialog,
} from "@/components/post-card/PhotoViewer"
import { shortcut } from "@/lib/channels/card-zoom"
import { getChannelPhotoSrc } from "@/lib/channels/channel-photo-cache"
import type { Channel } from "@/types"

export function ChannelAvatar({
  channel,
  className = "w-14 h-14",
  textClassName = "text-xl",
  view,
}: {
  channel: Pick<Channel, "id" | "name" | "displayName" | "photoUrl">
  className?: string
  textClassName?: string
  /**
   * Opens the photo in the Posts tab's viewer and puts it in the viewer's
   * gallery: the photo itself is the button, or a magnifier at the bottom
   * left of the nearest positioned ancestor, for a tile whose body selects.
   * Unset everywhere else, so post-header avatars never join the gallery.
   */
  view?: "image" | "corner"
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [viewing, setViewing] = useState(false)

  const gradientClass = getGradientFromName(channel.displayName || channel.name)
  const fallbackLetter =
    (channel.displayName || channel.name)[0]?.toUpperCase() ?? "?"

  useEffect(() => {
    let active = true
    setFailed(false)

    // Resolution (and any object URL) is owned by the shared cache, so avatars
    // for the same channel share one fetch and object URLs are not revoked here.
    getChannelPhotoSrc(channel.id, channel.photoUrl)
      .then((resolved) => {
        if (active) setSrc(resolved)
      })
      .catch(() => {
        if (!active) return
        setSrc(null)
        setFailed(true)
      })

    return () => {
      active = false
    }
  }, [channel.id, channel.photoUrl])

  if (src && !failed) {
    const title = channel.displayName || channel.name
    const img = (
      <img
        src={src}
        alt={title}
        {...(view ? { [GALLERY_CAPTION_ATTR]: title } : {})}
        className={`${className} rounded-full object-cover`}
        onError={() => {
          setFailed(true)
          setSrc(null)
        }}
      />
    )
    if (!view) return img
    const open = (e: React.MouseEvent) => {
      e.stopPropagation()
      setViewing(true)
    }
    const label = `View ${title}'s photo`
    return (
      <>
        {view === "corner" ? (
          <>
            {img}
            <button
              type="button"
              aria-label={label}
              {...shortcut("p")}
              onClick={open}
              className={`${PHOTO_CORNER_BUTTON_CLASS} -left-1`}
            >
              <ZoomIn size={10} />
            </button>
          </>
        ) : (
          // Raised over a compact card's selection layer.
          <button
            type="button"
            aria-label={label}
            {...shortcut("p")}
            onClick={open}
            className="relative z-20 block cursor-zoom-in rounded-full"
          >
            {img}
          </button>
        )}
        <PhotoViewerDialog
          start={src}
          open={viewing}
          onOpenChange={setViewing}
          title="Channel photo"
        />
      </>
    )
  }

  return (
    <div
      className={`${className} rounded-full overflow-hidden flex items-center justify-center text-white font-bold shadow-inner bg-gradient-to-br ${gradientClass} ${textClassName}`}
    >
      {fallbackLetter}
    </div>
  )
}

/**
 * A round button at a bottom corner of the photo (add `-left-1` or
 * `-right-1`), over a card's selection layer and shown on the card's hover or
 * keyboard focus.
 */
export const PHOTO_CORNER_BUTTON_CLASS =
  "absolute -bottom-1 z-20 w-6 h-6 bg-app-bg border border-app-ink/10 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-all shadow-sm hover:bg-app-ink hover:text-app-bg"

const getGradientFromName = (name: string) => {
  const gradients = [
    "from-blue-400 to-blue-600",
    "from-emerald-400 to-emerald-600",
    "from-violet-400 to-violet-600",
    "from-amber-400 to-orange-500",
    "from-pink-400 to-rose-500",
    "from-cyan-400 to-blue-500",
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const index = Math.abs(hash) % gradients.length
  return gradients[index]
}
