import { useEffect, useState } from "react"

import { api } from "@/api"
import type { Channel } from "@/types"

function isCachedPhotoUrl(photoUrl?: string): boolean {
  return Boolean(photoUrl?.includes("/telegram/channel-photo/"))
}

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
    let objectUrl: string | null = null
    setFailed(false)

    if (!channel.photoUrl) {
      setSrc(null)
      return
    }

    if (isCachedPhotoUrl(channel.photoUrl)) {
      api
        .fetchChannelPhoto(channel.id)
        .then((blob) => {
          objectUrl = URL.createObjectURL(blob)
          setSrc(objectUrl)
        })
        .catch(() => {
          setSrc(null)
          setFailed(true)
        })
      return () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl)
      }
    }

    if (channel.photoUrl.startsWith("http")) {
      setSrc(channel.photoUrl)
      return
    }

    setSrc(null)
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
