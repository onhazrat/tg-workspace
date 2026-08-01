import { Bot } from "lucide-react"
import { useEffect, useState } from "react"
import { api } from "@/api"
import type { BotCredential } from "@/types"

function resolveFilePath(photoUrl?: string | null): string | null {
  if (!photoUrl) return null
  if (photoUrl.includes("api.telegram.org/file/bot")) {
    const parts = photoUrl.split("/file/bot")
    const path = parts[1]?.split("/").slice(1).join("/")
    return path || null
  }
  if (!photoUrl.startsWith("http")) return photoUrl
  return null
}

export function BotAvatar({
  bot,
  className = "w-10 h-10",
}: {
  bot: BotCredential
  className?: string
}) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let objectUrl: string | null = null
    const path = resolveFilePath(bot.photoUrl)
    if (!path) {
      setSrc(null)
      return
    }
    api
      .fetchBotFile(bot.id, path)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      })
      .catch(() => setSrc(null))
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [bot.id, bot.photoUrl])

  if (src) {
    return (
      <img
        src={src}
        alt={bot.name}
        className={`${className} rounded-full border border-app-ink/10 object-cover`}
      />
    )
  }

  return (
    <div
      className={`${className} rounded-full bg-app-ink/5 border border-app-ink/10 flex items-center justify-center`}
    >
      <Bot size={16} className="opacity-40" />
    </div>
  )
}
