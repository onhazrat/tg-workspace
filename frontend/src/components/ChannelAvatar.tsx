import { useEffect, useState } from "react"

import { getChannelPhotoSrc } from "@/lib/channels/channel-photo-cache"
import type { Channel } from "@/types"

export function ChannelAvatar({
  channel,
  className = "w-14 h-14",
  textClassName = "text-xl",
}: {
  channel: Channel
  className?: string
  textClassName?: string
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

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
    return (
      <img
        src={src}
        alt={channel.displayName || channel.name}
        className={`${className} rounded-full object-cover`}
        onError={() => {
          setFailed(true)
          setSrc(null)
        }}
      />
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
