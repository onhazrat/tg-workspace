import {
  Activity,
  CheckCircle2,
  Loader2,
  Plus,
  RotateCcw,
  Send,
  Trash2,
} from "lucide-react"
import type React from "react"
import { TgButton } from "@/components/ui/tg-button"
import { TgIconButton } from "@/components/ui/tg-icon-button"
import { TgInput } from "@/components/ui/tg-input"
import { TgSettingsSection } from "@/components/ui/tg-settings-section"
import type { BotCredential, ChatDestination } from "@/types"
import { destinationStatus } from "./publishing-model"

export type DestValidationState = Record<
  string,
  { isValid: boolean; info?: string; loading: boolean }
>

type DestinationsPanelProps = {
  chatDestinations: ChatDestination[]
  botCredentials: BotCredential[]
  newDestChatId: string
  newDestName: string
  isAutoFetchingDest: boolean
  isSavingDest: boolean
  destValidation: DestValidationState
  onDestChatIdChange: (chatId: string) => void
  onDestNameChange: (name: string) => void
  onAddDestination: () => void
  onCheckDestination: (destId: string, chatId: string) => void
  onTestConnection: (
    botId: string,
    chatId: string,
    botName: string,
    destName: string,
  ) => void
  onDeleteDestination: (id: string) => void
}

export const DestinationsPanel: React.FC<DestinationsPanelProps> = ({
  chatDestinations,
  botCredentials,
  newDestChatId,
  newDestName,
  isAutoFetchingDest,
  isSavingDest,
  destValidation,
  onDestChatIdChange,
  onDestNameChange,
  onAddDestination,
  onCheckDestination,
  onTestConnection,
  onDeleteDestination,
}) => (
  <TgSettingsSection icon={Send} title="Chat Destinations">
    <p className="text-[10px] opacity-40 italic serif mb-6">
      Manage the channels, groups, or users where you want to publish summaries.
    </p>

    <div className="space-y-4 mb-8">
      <div className="flex flex-col gap-3">
        <div className="relative">
          <TgInput
            type="text"
            placeholder="Chat id (e.g. @mychannel or -100…)"
            value={newDestChatId}
            onChange={(e) => onDestChatIdChange(e.target.value)}
          />
          {isAutoFetchingDest && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <Loader2 size={12} className="animate-spin opacity-40" />
            </div>
          )}
        </div>
        <TgInput
          type="text"
          placeholder="Destination name (auto-filled or custom)"
          value={newDestName}
          onChange={(e) => onDestNameChange(e.target.value)}
        />
      </div>
      <TgButton
        type="button"
        variant="primary"
        size="lg"
        onClick={onAddDestination}
        loading={isSavingDest}
        loadingLabel="Saving…"
        className="w-full"
      >
        <Plus size={14} /> Save Destination
      </TgButton>
    </div>

    <div className="space-y-2">
      {chatDestinations.length === 0 ? (
        <div className="text-center py-8 opacity-30 italic serif text-[10px] border border-dashed border-app-ink/10">
          No destinations saved yet.
        </div>
      ) : (
        chatDestinations.map((dest) => (
          <DestinationRow
            key={dest.id}
            dest={dest}
            validation={destValidation[dest.id]}
            onCheck={() => onCheckDestination(dest.id, dest.chatId)}
            onTest={
              botCredentials.length > 0
                ? () => {
                    const bot = botCredentials[0]
                    onTestConnection(bot.id, dest.chatId, bot.name, dest.name)
                  }
                : undefined
            }
            onDelete={() => onDeleteDestination(dest.id)}
          />
        ))
      )}
    </div>
  </TgSettingsSection>
)

/**
 * One saved destination: its name and chat id, the hover actions, and the
 * status row once it has been checked. Test Connection appears only when the
 * caller passes `onTest`, which it does only while a bot exists to test with.
 */
export function DestinationRow({
  dest,
  validation,
  onCheck,
  onTest,
  onDelete,
}: {
  dest: ChatDestination
  validation?: DestValidationState[string]
  onCheck: () => void
  onTest?: () => void
  onDelete: () => void
}) {
  return (
    <div className="group flex flex-col p-4 border border-app-ink/10 bg-app-card hover:border-app-ink/30 transition-all gap-4">
      <div className="flex justify-between items-start">
        <div className="flex items-start gap-4 min-w-0 flex-1">
          <div className="relative shrink-0 mt-0.5">
            <div className="w-10 h-10 rounded-full bg-app-ink/5 border border-app-ink/10 flex items-center justify-center">
              <Send size={16} className="opacity-40" />
            </div>
            {validation?.isValid && (
              <div
                className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-app-card flex items-center justify-center"
                data-testid="destination-valid-badge"
              >
                <CheckCircle2 size={10} className="text-white" />
              </div>
            )}
          </div>
          <div className="min-w-0 pt-0.5">
            <h3 className="text-[11px] font-bold uppercase tracking-widest truncate">
              {dest.name}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[9px] font-mono opacity-40 truncate">
                {dest.chatId}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <TgIconButton
            aria-label="Verify Destination"
            tooltip="Verify Destination"
            onClick={onCheck}
            loading={validation?.loading}
            className="rounded-full opacity-60 hover:opacity-100"
          >
            <Activity size={14} />
          </TgIconButton>
          {onTest && (
            <TgIconButton
              aria-label="Test Connection"
              tooltip="Test Connection"
              onClick={onTest}
              className="rounded-full opacity-60 hover:opacity-100"
            >
              <RotateCcw size={14} />
            </TgIconButton>
          )}
          <TgIconButton
            aria-label="Delete Destination"
            tooltip="Delete Destination"
            onClick={onDelete}
            className="rounded-full text-red-500 opacity-60 hover:opacity-100 hover:bg-red-500/10"
          >
            <Trash2 size={14} />
          </TgIconButton>
        </div>
      </div>
      {validation && <DestinationStatus validation={validation} />}
    </div>
  )
}

function DestinationStatus({
  validation,
}: {
  validation: DestValidationState[string]
}) {
  const status = destinationStatus(validation)
  return (
    <div className="flex items-center justify-between pt-3 border-t border-app-ink/5">
      <div className="flex items-center gap-6">
        <div className="flex flex-col">
          <span className="text-[8px] font-mono uppercase tracking-widest opacity-40 mb-0.5">
            Status
          </span>
          <span
            className={`text-[10px] font-mono uppercase tracking-widest ${status.toneClass}`}
            data-testid="destination-status"
          >
            {status.label}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[8px] font-mono uppercase tracking-widest opacity-40 mb-0.5">
            Details
          </span>
          <span
            className="text-[10px] font-mono uppercase tracking-widest max-w-[150px] truncate"
            data-testid="destination-details"
          >
            {status.details}
          </span>
        </div>
      </div>
    </div>
  )
}
