import {
  Bot,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react"
import type React from "react"
import { BotAvatar } from "@/components/BotAvatar"
import { RelativeTime } from "@/components/RelativeTime"
import { TgButton } from "@/components/ui/tg-button"
import { TgIconButton } from "@/components/ui/tg-icon-button"
import { TgInput } from "@/components/ui/tg-input"
import { TgSettingsSection } from "@/components/ui/tg-settings-section"
import type { BotCredential, PublishLog } from "@/types"

export type BotValidationState = Record<
  string,
  { isValid: boolean; botInfo?: string; loading: boolean }
>

type BotCredentialsPanelProps = {
  botCredentials: BotCredential[]
  publishLogs: PublishLog[]
  newBotToken: string
  newBotName: string
  isAutoFetchingBot: boolean
  isSavingBot: boolean
  botValidation: BotValidationState
  onBotTokenChange: (token: string) => void
  onBotNameChange: (name: string) => void
  onAddBot: () => void
  onCheckBot: (id: string) => void
  onDeleteBot: (id: string) => void
}

export const BotCredentialsPanel: React.FC<BotCredentialsPanelProps> = ({
  botCredentials,
  publishLogs,
  newBotToken,
  newBotName,
  isAutoFetchingBot,
  isSavingBot,
  botValidation,
  onBotTokenChange,
  onBotNameChange,
  onAddBot,
  onCheckBot,
  onDeleteBot,
}) => (
  <TgSettingsSection icon={Bot} title="Bot Credentials">
    <p className="text-[10px] opacity-40 italic serif mb-6">
      Add your Telegram Bot tokens here to enable automated publishing and
      testing.
    </p>

    <div className="space-y-4 mb-8">
      <div className="flex flex-col gap-3">
        <div className="relative">
          <TgInput
            type="password"
            placeholder="BOT TOKEN (FROM @BOTFATHER)"
            value={newBotToken}
            onChange={(e) => onBotTokenChange(e.target.value)}
          />
          {isAutoFetchingBot && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <Loader2 size={12} className="animate-spin opacity-40" />
            </div>
          )}
        </div>
        <TgInput
          type="text"
          placeholder="BOT NAME (AUTO-FILLED OR CUSTOM)"
          value={newBotName}
          onChange={(e) => onBotNameChange(e.target.value)}
        />
      </div>
      <TgButton
        type="button"
        variant="primary"
        size="lg"
        onClick={onAddBot}
        loading={isSavingBot}
        loadingLabel="Saving…"
        className="w-full"
      >
        <Plus size={14} /> Save Bot
      </TgButton>
    </div>

    <div className="space-y-2">
      {botCredentials.length === 0 ? (
        <div className="text-center py-8 opacity-30 italic serif text-[10px] border border-dashed border-app-ink/10">
          No bot credentials saved yet.
        </div>
      ) : (
        botCredentials.map((bot) => {
          const botStats = publishLogs.filter(
            (l) => l.botId === bot.id && l.status === "success",
          ).length
          return (
            <div
              key={bot.id}
              className="group flex flex-col p-4 border border-app-ink/10 bg-app-card hover:border-app-ink/30 transition-all gap-4"
            >
              <div className="flex justify-between items-start">
                <div className="flex items-start gap-4 min-w-0 flex-1">
                  <div className="relative shrink-0 mt-0.5">
                    <BotAvatar bot={bot} />
                    {botValidation[bot.id]?.isValid && (
                      <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-app-card flex items-center justify-center">
                        <CheckCircle2 size={10} className="text-white" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[11px] font-bold uppercase tracking-widest truncate">
                      {bot.name}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      {bot.username && (
                        <span className="text-[9px] font-mono text-blue-500">
                          @{bot.username}
                        </span>
                      )}
                      <span className="text-[9px] font-mono opacity-40 truncate">
                        {bot.hasToken ? "Token stored on server" : "No token"}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <TgIconButton
                    aria-label="Validate Token"
                    tooltip="Validate Token"
                    onClick={() => onCheckBot(bot.id)}
                    loading={botValidation[bot.id]?.loading}
                    className="rounded-full opacity-60 hover:opacity-100"
                  >
                    <RefreshCw size={14} />
                  </TgIconButton>
                  <TgIconButton
                    aria-label="Delete Bot"
                    tooltip="Delete Bot"
                    onClick={() => onDeleteBot(bot.id)}
                    className="rounded-full text-red-500 opacity-60 hover:opacity-100 hover:bg-red-500/10"
                  >
                    <Trash2 size={14} />
                  </TgIconButton>
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-app-ink/5">
                <div className="flex items-center gap-6">
                  <div className="flex flex-col">
                    <span className="text-[8px] font-mono uppercase tracking-widest opacity-40 mb-0.5">
                      Status
                    </span>
                    <span
                      className={`text-[10px] font-mono uppercase tracking-widest ${botValidation[bot.id]?.isValid ? "text-green-500" : botValidation[bot.id]?.isValid === false ? "text-red-500" : "opacity-40"}`}
                    >
                      {botValidation[bot.id]?.loading
                        ? "Checking..."
                        : botValidation[bot.id]?.isValid
                          ? "Active"
                          : botValidation[bot.id]?.isValid === false
                            ? "Invalid"
                            : "Unknown"}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[8px] font-mono uppercase tracking-widest opacity-40 mb-0.5">
                      Messages Sent
                    </span>
                    <span className="text-[10px] font-bold font-mono">
                      {botStats}
                    </span>
                  </div>
                  {bot.lastValidated && (
                    <div className="flex flex-col">
                      <span className="text-[8px] font-mono uppercase tracking-widest opacity-40 mb-0.5">
                        Last Validated
                      </span>
                      <span className="text-[10px] font-mono opacity-60">
                        <RelativeTime timestamp={bot.lastValidated} />
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })
      )}
    </div>
  </TgSettingsSection>
)
