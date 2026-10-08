import { ZoomIn } from "lucide-react"
import { useEffect, useState } from "react"

import {
  GALLERY_CAPTION_ATTR,
  PhotoViewerDialog,
} from "@/components/post-card/PhotoViewer"
import { getChannelPhotoSrc } from "@/lib/channels/channel-photo-cache"
import type { Channel } from "@/types"

export function ChannelAvatar({
  channel,
  className = "w-14 h-14",
  textClassName = "text-xl",
  viewable = false,
  viewTrigger = "image",
  viewShortcut,
}: {
  channel: Pick<Channel, "id" | "name" | "displayName" | "photoUrl">
  className?: string
  textClassName?: string
  /**
   * A click opens the photo in the Posts tab's viewer, and the photo joins
   * its gallery. Only the Channels tab's cards ask, so the Posts feed's
   * gallery never picks up the avatars in its post headers.
   */
  viewable?: boolean
  /**
   * What opens it: the photo itself, or a magnifier in the corner of the
   * nearest positioned ancestor, for a tile whose photo is its selection
   * control. The corner button shows on the ancestor's `group` hover.
   */
  viewTrigger?: "image" | "corner"
  /** Keyboard mode's letter for opening it. */
  viewShortcut?: string
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
        {...(viewable ? { [GALLERY_CAPTION_ATTR]: title } : {})}
        className={`${className} rounded-full object-cover`}
        onError={() => {
          setFailed(true)
          setSrc(null)
        }}
      />
    )
    if (!viewable) return img
    const open = (e: React.MouseEvent) => {
      e.stopPropagation()
      setViewing(true)
    }
    return (
      <>
        {viewTrigger === "corner" ? (
          <>
            {img}
            <button
              type="button"
              aria-label={`View ${title}'s photo`}
              data-shortcut={viewShortcut}
              onClick={open}
              className="absolute bottom-1 right-1 z-20 flex h-5 w-5 items-center justify-center rounded-full bg-app-bg/90 text-app-ink opacity-0 shadow-sm ring-1 ring-app-ink/10 transition-opacity hover:bg-app-ink hover:text-app-bg focus-visible:opacity-100 group-hover:opacity-100"
            >
              <ZoomIn size={11} />
            </button>
          </>
        ) : (
          <button
            type="button"
            aria-label={`View ${title}'s photo`}
            data-shortcut={viewShortcut}
            className="block cursor-zoom-in rounded-full"
            onClick={open}
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

export const getGradientFromName = (name: string) => {
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
