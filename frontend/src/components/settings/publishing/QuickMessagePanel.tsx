import { MessageSquare, Send } from "lucide-react"
import type React from "react"
import { toast } from "sonner"
import { TgButton } from "@/components/ui/tg-button"
import { TgTextarea, tgFieldClassName } from "@/components/ui/tg-input"
import { TgSettingsSection } from "@/components/ui/tg-settings-section"
import type { BotCredential, ChatDestination } from "@/types"

type QuickMessagePanelProps = {
  botCredentials: BotCredential[]
  chatDestinations: ChatDestination[]
  selectedQuickBotId: string
  selectedQuickDestId: string
  quickMessage: string
  onSelectBot: (id: string) => void
  onSelectDest: (id: string) => void
  onMessageChange: (text: string) => void
  onPublish: (
    botId: string,
    chatId: string,
    botName: string,
    text: string,
    destName: string,
  ) => void
}

export const QuickMessagePanel: React.FC<QuickMessagePanelProps> = ({
  botCredentials,
  chatDestinations,
  selectedQuickBotId,
  selectedQuickDestId,
  quickMessage,
  onSelectBot,
  onSelectDest,
  onMessageChange,
  onPublish,
}) => (
  <TgSettingsSection icon={MessageSquare} title="Quick Message">
    <p className="text-[10px] opacity-40 italic serif mb-6">
      Send an arbitrary message using a selected bot to a selected destination.
    </p>

    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3">
        <select
          value={selectedQuickBotId}
          onChange={(e) => onSelectBot(e.target.value)}
          className={tgFieldClassName}
        >
          <option value="">SELECT BOT</option>
          {botCredentials.map((b) => (
            <option
              key={b.id}
              value={b.id}
              className="bg-app-card text-app-ink"
            >
              {b.name.toUpperCase()}
            </option>
          ))}
        </select>
        <select
          value={selectedQuickDestId}
          onChange={(e) => onSelectDest(e.target.value)}
          className={tgFieldClassName}
        >
          <option value="">SELECT DESTINATION</option>
          {chatDestinations.map((d) => (
            <option
              key={d.id}
              value={d.id}
              className="bg-app-card text-app-ink"
            >
              {d.name.toUpperCase()}
            </option>
          ))}
        </select>
      </div>
      <TgTextarea
        placeholder="TYPE YOUR MESSAGE HERE..."
        value={quickMessage}
        onChange={(e) => onMessageChange(e.target.value)}
        rows={4}
        className="resize-none"
      />
      <TgButton
        type="button"
        variant="primary"
        size="lg"
        onClick={() => {
          const bot = botCredentials.find((b) => b.id === selectedQuickBotId)
          const dest = chatDestinations.find(
            (d) => d.id === selectedQuickDestId,
          )
          if (bot && dest && quickMessage) {
            onPublish(bot.id, dest.chatId, bot.name, quickMessage, dest.name)
            onMessageChange("")
          } else {
            toast.error(
              "Please select a bot, a destination, and type a message.",
            )
          }
        }}
        disabled={!selectedQuickBotId || !selectedQuickDestId || !quickMessage}
        className="w-full"
      >
        <Send size={14} /> Send Message
      </TgButton>
    </div>
  </TgSettingsSection>
)
