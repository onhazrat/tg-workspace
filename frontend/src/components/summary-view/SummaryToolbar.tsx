import { Send } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { TgButton } from "@/components/ui/tg-button"
import type { BotCredential, ChatDestination } from "@/types"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tg-tooltip"
import { TELEGRAM_MESSAGE_LIMIT } from "./summary-text"

const SELECT =
  "bg-transparent border border-app-ink border-opacity-20 rounded-lg py-1.5 px-2 focus:outline-none focus:border-opacity-100 transition-colors text-[11px] font-mono appearance-none cursor-pointer"

function ToolbarButton({
  tooltip,
  ...props
}: React.ComponentProps<typeof TgButton> & { tooltip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <TgButton type="button" variant="ghost" size="sm" {...props} />
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  )
}

/** Pick a bot and a destination, then publish. Hidden until both lists have an entry. */
export function PublishControls({
  bots,
  destinations,
  onPublish,
}: {
  bots: BotCredential[]
  destinations: ChatDestination[]
  onPublish: (bot: BotCredential, destination: ChatDestination) => void
}) {
  const [botId, setBotId] = useState("")
  const [destId, setDestId] = useState("")
  if (bots.length === 0 || destinations.length === 0) return null
  return (
    <div className="flex items-center gap-2 mr-4">
      <select
        aria-label="Bot"
        value={botId}
        onChange={(e) => setBotId(e.target.value)}
        className={SELECT}
      >
        <option value="">Bot</option>
        {bots.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Destination"
        value={destId}
        onChange={(e) => setDestId(e.target.value)}
        className={SELECT}
      >
        <option value="">Dest</option>
        {destinations.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <ToolbarButton
        tooltip="Sends the summary to the selected Telegram destination."
        onClick={() => {
          const bot = bots.find((b) => b.id === botId)
          const dest = destinations.find((d) => d.id === destId)
          if (bot && dest) onPublish(bot, dest)
          else toast.error("Please select both Bot and Destination.")
        }}
        disabled={!botId || !destId}
      >
        <Send size={12} />
        Publish
      </ToolbarButton>
    </div>
  )
}

export function TelegramLengthHint({ length }: { length: number }) {
  const exceeds = length > TELEGRAM_MESSAGE_LIMIT
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-mono">
      <span
        className={`rounded-md px-2 py-1 ${exceeds ? "bg-red-500/10 text-red-600" : "bg-app-muted/40 text-app-ink/60"}`}
      >
        Telegram chars: {length}/{TELEGRAM_MESSAGE_LIMIT}
      </span>
      {exceeds && (
        <span className="text-red-600/90">
          Message may exceed Telegram single-message limit.
        </span>
      )}
    </div>
  )
}
