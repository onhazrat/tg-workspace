import type React from "react"
import { useState } from "react"
import { usePublishing } from "@/hooks/usePublishing"
import { QuickMessagePanel } from "./QuickMessagePanel"

/** Send any text with a saved bot to a saved destination, logged like a test. */
export const QuickMessageTool: React.FC = () => {
  const p = usePublishing()
  const [botId, setBotId] = useState("")
  const [destId, setDestId] = useState("")
  const [text, setText] = useState("")
  if (!p.bots.length || !p.destinations.length)
    return (
      <p className="text-xs text-app-ink/60">
        Add a bot and a destination in Settings, Publishing first.
      </p>
    )
  return (
    <QuickMessagePanel
      botCredentials={p.bots}
      chatDestinations={p.destinations}
      selectedQuickBotId={botId}
      selectedQuickDestId={destId}
      quickMessage={text}
      onSelectBot={setBotId}
      onSelectDest={setDestId}
      onMessageChange={setText}
      onPublish={(id, chatId, _botName, message) => {
        const bot = p.bots.find((b) => b.id === id)
        const dest = p.destinations.find((d) => d.id === destId)
        if (bot && dest?.chatId === chatId)
          void p.send("quick", bot, dest, message)
      }}
    />
  )
}
