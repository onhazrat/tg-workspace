import { motion } from "motion/react"
import type React from "react"
import { useState } from "react"
import { ArtifactScopeLine } from "@/components/ArtifactScopeLine"
import {
  ChatComposer,
  ChatHistoryActions,
  ChatLanguageAndModel,
  ChatModeToggle,
  ChatThinking,
  ChatTurn,
  EmbeddingsStatus,
} from "@/components/chat/ChatViewParts"
import {
  chatTranscriptText,
  chatViewSections,
} from "@/components/chat/chat-view-model"
import { GoToActionEmptyState } from "@/components/history/GoToActionEmptyState"
import { useChatContext } from "../contexts/ChatContext"
import { useRAG } from "../contexts/RAGContext"
import { useSettings } from "../contexts/SettingsContext"
import { useUI } from "../contexts/UIContext"
import { useChatSessionQuery } from "../hooks/useChatSessions"
import { ModelCombo } from "./ai/ModelCombo"

export const ChatView: React.FC = () => {
  const [copied, setCopied] = useState(false)
  const [expandedSources, setExpandedSources] = useState<
    Record<number, boolean>
  >({})

  const {
    aiLanguage,
    setAiLanguage,
    selectedModel,
    setSelectedModel,
    isRTL,
    resolvedTheme: theme,
    embeddingsEnabled,
  } = useSettings()
  const { currentChatSessionId, setCurrentSummaryId, setCurrentChatSessionId } =
    useUI()
  const { data: chatSession } = useChatSessionQuery(currentChatSessionId)
  const { isSyncing, progress } = useRAG()
  const {
    chatMessages,
    setChatMessages,
    chatInput,
    setChatInput,
    isChatting,
    chatMode,
    setChatMode,
    chatEndRef,
    chatInputRef,
    handleSendMessage,
  } = useChatContext()

  const toggleSources = (index: number) => {
    setExpandedSources((prev) => ({ ...prev, [index]: !prev[index] }))
  }

  const copyHistory = () => {
    navigator.clipboard.writeText(chatTranscriptText(chatMessages))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const clearConversation = () => {
    setChatMessages([])
    // Both ids, or the next message writes the new turns over the
    // transcript of the conversation just cleared:
    // `handleSendMessage` reuses `currentChatSessionId` and the
    // payload write replaces `messages` wholesale.
    setCurrentChatSessionId(null)
    setCurrentSummaryId(null)
    setExpandedSources({})
  }

  const sections = chatViewSections(chatMessages.length, isChatting)

  return (
    <motion.div
      key="chat"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full"
    >
      {/* Header Toolbar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 bg-app-card border border-app-ink/10 p-3 rounded-xl shadow-sm shrink-0">
        <div className="flex flex-wrap items-center gap-4">
          <ChatModeToggle
            chatMode={chatMode}
            onChange={setChatMode}
            embeddingsEnabled={embeddingsEnabled}
          />
          <ChatLanguageAndModel
            aiLanguage={aiLanguage}
            onLanguageChange={setAiLanguage}
            modelPicker={
              <ModelCombo
                // Not "Inference model": that label belongs to the Action tab's
                // one bar, and `summarizer-shell.spec.ts` asserts exactly one
                // control on the page carries it.
                ariaLabel="Chat model"
                value={selectedModel}
                onChange={setSelectedModel}
                className="bg-transparent border-none py-0 focus:outline-none text-[10px] font-bold uppercase tracking-tight hover:opacity-100 opacity-80 transition-opacity max-w-[120px] truncate"
              />
            }
          />
        </div>

        <div className="flex items-center gap-3">
          <EmbeddingsStatus
            embeddingsEnabled={embeddingsEnabled}
            isSyncing={isSyncing}
            progress={progress}
          />
          <ChatHistoryActions
            hasTurns={chatMessages.length > 0}
            copied={copied}
            onCopy={copyHistory}
            onClear={clearConversation}
          />
        </div>
      </div>

      {/*
       * The Scope this conversation was answered from (AW-08).
       *
       * Only once a session exists: before the first turn there is no frozen
       * window to show, and the workspace's own is one tab away in the Posts
       * editor. Rendering the live one here would say a chat had been answered
       * from a window it has never seen.
       */}
      {chatSession && (
        <div className="mb-4 shrink-0">
          <ArtifactScopeLine artifact={chatSession} />
        </div>
      )}

      {/* Chat Feed */}
      <div className="flex-1 overflow-y-auto space-y-6 mb-4 pr-2 custom-scrollbar">
        {sections.empty && (
          /*
           * A result tab with no result (AW-09).
           *
           * This used to be three suggested prompts, each of which started a
           * conversation — so Chat was a fifth place an Artifact could begin,
           * with its own idea of what the Scope was. Every Artifact begins in
           * Actions now, and the composer below goes with the prompts: it
           * carries an existing conversation on, and there is none.
           */
          <GoToActionEmptyState
            what="conversation"
            description="A chat starts with a question, and questions are asked on the Action tab. Open a past conversation from History, or ask a new one there."
          />
        )}

        {chatMessages.map((m, i) => (
          <ChatTurn
            key={i}
            message={m}
            sourcesOpen={expandedSources[i] === true}
            onToggleSources={() => toggleSources(i)}
            onCopy={(text) => navigator.clipboard.writeText(text)}
            isRTL={isRTL}
            theme={theme}
            aiLanguage={aiLanguage}
          />
        ))}

        <ChatThinking active={isChatting} />
        <div ref={chatEndRef} />
      </div>

      {/*
       * The composer, only where there is a conversation to carry on — and
       * while one is being started, so a first turn that fails has somewhere
       * to be retried rather than a "go to Action" that has already eaten the
       * question.
       */}
      {sections.composer && (
        <ChatComposer
          input={chatInput}
          onInputChange={setChatInput}
          onSend={() => void handleSendMessage()}
          isChatting={isChatting}
          inputRef={chatInputRef}
        />
      )}
    </motion.div>
  )
}
