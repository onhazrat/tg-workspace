import { MessageSquare, Send } from "lucide-react"
import type React from "react"

import {
  ACTION_SWITCH_OPTION_CLASS,
  ActionRow,
} from "@/components/action/ActionRow"
import { startChatButton } from "@/components/action/action-view-model"
import { TgButton } from "@/components/ui/tg-button"
import { TgSegmentedControl } from "@/components/ui/tg-segmented"
import { useChatContext } from "@/contexts/ChatContext"
import { useSettings } from "@/contexts/SettingsContext"
import { useUI } from "@/contexts/UIContext"
import { useSelectedAiKeyId } from "@/hooks/useAiKeys"
import { useApiStatus } from "@/hooks/useApiStatus"
import type { ChatMode } from "@/types"

/**
 * Start a chat by asking its first question.
 *
 * Chat has an input here and on the Chat tab, and that is not duplication. A
 * chat only exists once someone has asked something, so the create form *is*
 * a message box; the composer on the Chat tab then carries the conversation
 * on, where it has to stay for autoscroll and focus to work against the
 * transcript.
 */
export const ChatAction: React.FC = () => {
  const { workspaceTabs } = useUI()
  const {
    chatMode,
    setChatMode,
    setChatInput,
    setChatMessages,
    handleSendMessage,
    isChatting,
    actionDraft: draft,
    setActionDraft: setDraft,
  } = useChatContext()
  const { embeddingsEnabled } = useSettings()
  const { isOffline } = useApiStatus()
  const button = startChatButton({
    draft,
    isChatting,
    isOffline,
    noKey: useSelectedAiKeyId() === null,
  })

  /**
   * Open a conversation with its first question already asked.
   *
   * The three explicit arguments are the point. Clearing the transcript and
   * the session id is not enough on its own: `handleSendMessage` reads both
   * from state captured before this render, so it would send the new question
   * after the last conversation's turns and save the result *over* that
   * conversation's transcript. Saying `[]` and `null` outright is the only
   * version that cannot race the re-render.
   */
  const startChat = () => {
    const question = draft.trim()
    if (!question || isChatting) return
    setDraft("")
    setChatInput("")
    setChatMessages([])
    // The empty Chat tab, or a new one; the first turn fills it.
    workspaceTabs.openTab("chat")
    void handleSendMessage({ message: question, history: [], sessionId: null })
  }

  return (
    <ActionRow
      icon={MessageSquare}
      title="Chat"
      description="Ask questions instead of generating a document. The first message opens the conversation."
      controls={
        <>
          <TgSegmentedControl<ChatMode>
            size="sm"
            aria-label="Chat mode"
            value={chatMode}
            onChange={setChatMode}
            optionClassName={ACTION_SWITCH_OPTION_CLASS}
            className="shrink-0"
            options={[
              { value: "full_scope", label: "Selected posts" },
              {
                value: "semantic",
                label: "Semantic",
                disabled: !embeddingsEnabled,
              },
            ]}
          />
          <input
            data-testid="action-chat-input"
            aria-label="First question"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                startChat()
              }
            }}
            placeholder="Ask about trends, topics, or the channels in scope…"
            className="h-9 min-w-0 flex-1 rounded-md border border-app-ink/15 bg-app-muted/20 px-3 text-[13px] transition-all focus:border-app-ink/30 focus:outline-none focus:ring-4 focus:ring-app-ink/5"
          />
        </>
      }
      primary={
        <TgButton
          data-testid="action-start-chat"
          onClick={startChat}
          disabled={button.disabled}
          title={button.title}
          loading={isChatting}
          loadingLabel="Starting…"
        >
          <Send size={13} />
          Start a chat
        </TgButton>
      }
    />
  )
}
