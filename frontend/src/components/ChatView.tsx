import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Database,
  FileText,
  Loader2,
  Plus,
  Send,
  Sparkles,
  User,
  Zap,
} from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import type React from "react"
import { useState } from "react"
import ReactMarkdown from "react-markdown"
import { TgButton } from "@/components/ui/tg-button"
import { TgIconButton } from "@/components/ui/tg-icon-button"
import { TgFieldLabel } from "@/components/ui/tg-input"
import { TgHeroEmptyState } from "@/components/ui/tg-segmented"
import { LANGUAGES, MODELS } from "../constants"
import { useChatContext } from "../contexts/ChatContext"
import { useRAG } from "../contexts/RAGContext"
import { useSettings } from "../contexts/SettingsContext"
import { useUI } from "../contexts/UIContext"
import { replaceCitations } from "../lib/citations/replace-citations"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tg-tooltip"

const SUGGESTED_PROMPTS_SUMMARY = [
  "Summarize the latest trends in these channels",
  "What are the most active discussions about?",
  "Identify any key announcements or news",
]

const SUGGESTED_PROMPTS_HISTORY = [
  "What did we discuss about AI models previously?",
  "Find mentions of specific project deadlines",
  "Summarize past conversations about API limits",
]

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
  const { setCurrentSummaryId, setCurrentChatSessionId } = useUI()
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

  const handleSuggestedPrompt = (prompt: string) => {
    setChatInput(prompt)
    setTimeout(() => {
      if (chatInputRef.current) {
        chatInputRef.current.focus()
      }
    }, 50)
  }

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
          <div className="flex items-center bg-app-muted rounded-lg p-1 border border-app-ink/10">
            <button
              type="button"
              onClick={() => setChatMode("full_scope")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-tight transition-all ${
                chatMode === "full_scope"
                  ? "bg-app-card text-app-ink shadow-sm"
                  : "text-app-ink opacity-60 hover:opacity-100 hover:bg-app-ink/5"
              }`}
            >
              <FileText size={12} />
              Full Scope
            </button>
            {embeddingsEnabled && (
              <button
                type="button"
                onClick={() => setChatMode("semantic")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-tight transition-all ${
                  chatMode === "semantic"
                    ? "bg-app-card text-app-ink shadow-sm"
                    : "text-app-ink opacity-60 hover:opacity-100 hover:bg-app-ink/5"
                }`}
              >
                <Database size={12} />
                Semantic
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 border-l border-app-ink/10 pl-4">
            <div className="flex items-center gap-2">
              <span className="text-[9px] uppercase font-bold opacity-40">
                Lang:
              </span>
              <select
                value={aiLanguage}
                onChange={(e) => setAiLanguage(e.target.value)}
                className="bg-transparent border-none py-0 focus:outline-none text-[10px] font-bold uppercase tracking-tight cursor-pointer hover:opacity-100 opacity-80 transition-opacity"
              >
                {LANGUAGES.map((l) => (
                  <option
                    key={l}
                    value={l}
                    className="bg-app-card text-app-ink"
                  >
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 border-l border-app-ink/10 pl-3">
              <span className="text-[9px] uppercase font-bold opacity-40">
                Model:
              </span>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="bg-transparent border-none py-0 focus:outline-none text-[10px] font-bold uppercase tracking-tight cursor-pointer hover:opacity-100 opacity-80 transition-opacity max-w-[120px] truncate"
              >
                {MODELS.map((m) => (
                  <option
                    key={m.id}
                    value={m.id}
                    className="bg-app-card text-app-ink"
                  >
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {embeddingsEnabled &&
            (isSyncing ? (
              <div className="flex items-center gap-2 text-[9px] uppercase font-bold text-blue-500 bg-blue-500/10 px-2 py-1 rounded-md">
                <Loader2 size={12} className="animate-spin" />
                {progress.total > 0
                  ? `Syncing (${progress.current}/${progress.total})`
                  : "Checking..."}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[9px] uppercase font-bold text-green-500 bg-green-500/10 px-2 py-1 rounded-md">
                <Check size={12} />
                Embeddings Ready
              </div>
            ))}
          {chatMessages.length > 0 && (
            <>
              <TgIconButton
                aria-label="Copy Chat History"
                tooltip="Copy Chat History"
                onClick={() => {
                  const fullHistory = chatMessages
                    .map(
                      (m) =>
                        `**${m.role === "user" ? "User" : "AI Analyst"}**:\n${m.text}`,
                    )
                    .join("\n\n---\n\n")
                  navigator.clipboard.writeText(fullHistory)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }}
                className="text-app-ink/40"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </TgIconButton>
              <TgIconButton
                aria-label="Clear Conversation"
                tooltip="Clear Conversation"
                onClick={() => {
                  setChatMessages([])
                  // Both ids, or the next message writes the new turns over the
                  // transcript of the conversation just cleared:
                  // `handleSendMessage` reuses `currentChatSessionId` and the
                  // payload write replaces `messages` wholesale.
                  setCurrentChatSessionId(null)
                  setCurrentSummaryId(null)
                  setExpandedSources({})
                }}
                className="text-app-ink/40 hover:text-red-500 hover:bg-red-500/10"
              >
                <Plus size={14} className="rotate-45" />
              </TgIconButton>
            </>
          )}
        </div>
      </div>

      {/* Chat Feed */}
      <div className="flex-1 overflow-y-auto space-y-6 mb-4 pr-2 custom-scrollbar">
        {chatMessages.length === 0 && (
          <TgHeroEmptyState
            className="h-full max-w-md mx-auto py-10"
            icon={
              chatMode === "full_scope" ? (
                <FileText size={28} className="opacity-40" />
              ) : (
                <Database size={28} className="opacity-40" />
              )
            }
            title={
              chatMode === "full_scope"
                ? "Chat over the full scope"
                : "Chat over semantic matches"
            }
            description={
              chatMode === "full_scope"
                ? "Ask about every post in the current scope — the selected channels, date range and filters."
                : "Ask across everything saved. A vector search picks the posts most relevant to each question."
            }
          >
            <div className="w-full space-y-2">
              <TgFieldLabel className="mb-3 text-[9px] font-sans font-bold tracking-widest opacity-40 text-left pl-1">
                Suggested Prompts
              </TgFieldLabel>
              {(chatMode === "full_scope"
                ? SUGGESTED_PROMPTS_SUMMARY
                : SUGGESTED_PROMPTS_HISTORY
              ).map((prompt, idx) => (
                <button
                  type="button"
                  key={idx}
                  onClick={() => handleSuggestedPrompt(prompt)}
                  className="w-full text-left p-3 text-[11px] bg-app-card hover:bg-app-muted border border-app-ink/10 rounded-xl transition-all flex items-center gap-3 group shadow-sm hover:shadow-md"
                >
                  <Zap
                    size={14}
                    className="opacity-40 group-hover:opacity-100 group-hover:text-blue-500 transition-colors shrink-0"
                  />
                  <span className="opacity-80 group-hover:opacity-100 font-medium">
                    {prompt}
                  </span>
                </button>
              ))}
            </div>
          </TgHeroEmptyState>
        )}

        {chatMessages.map((m, i) => (
          <div
            key={i}
            className={`flex gap-4 ${m.role === "user" ? "flex-row-reverse" : "flex-row"} group/message`}
          >
            {/* Avatar */}
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${
                m.role === "user"
                  ? "bg-app-ink text-app-bg"
                  : "bg-blue-500/10 text-blue-600 border border-blue-500/20"
              }`}
            >
              {m.role === "user" ? <User size={14} /> : <Sparkles size={14} />}
            </div>

            {/* Bubble Container */}
            <div
              className={`relative max-w-[85%] sm:max-w-[75%] flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
            >
              {/* Message Bubble */}
              <div
                className={`p-4 text-[13px] leading-relaxed relative group/bubble ${
                  m.role === "user"
                    ? "bg-app-ink text-app-bg rounded-2xl rounded-tr-sm shadow-md"
                    : "bg-app-card border border-app-ink/10 rounded-2xl rounded-tl-sm shadow-sm"
                }`}
              >
                <TgIconButton
                  aria-label="Copy message"
                  tooltip="Copy message"
                  onClick={() => navigator.clipboard.writeText(m.text)}
                  className={`absolute -top-3 shadow-sm opacity-0 group-hover/bubble:opacity-100 focus-visible:opacity-100 ${
                    m.role === "user"
                      ? "-left-3 bg-app-card text-app-ink border border-app-ink/10"
                      : "-right-3 bg-app-ink text-app-bg"
                  }`}
                >
                  <Copy size={12} />
                </TgIconButton>

                <div
                  dir={isRTL ? "rtl" : "ltr"}
                  className={`prose prose-sm max-w-none ${
                    m.role === "user"
                      ? theme === "light"
                        ? "prose-invert"
                        : ""
                      : "dark:prose-invert"
                  } ${isRTL ? "text-right" : ""} ${aiLanguage === "Persian" ? "font-persian leading-loose" : isRTL ? "font-serif leading-loose" : ""}`}
                >
                  <ReactMarkdown
                    components={{
                      p: ({ node, children, ...props }) => (
                        <p {...props}>
                          {replaceCitations(children, (channelName, postId) =>
                            m.sources?.find(
                              (s) =>
                                s.channelName === channelName &&
                                s.id === postId,
                            ),
                          )}
                        </p>
                      ),
                      li: ({ node, children, ...props }) => (
                        <li {...props}>
                          {replaceCitations(children, (channelName, postId) =>
                            m.sources?.find(
                              (s) =>
                                s.channelName === channelName &&
                                s.id === postId,
                            ),
                          )}
                        </li>
                      ),
                    }}
                  >
                    {m.text}
                  </ReactMarkdown>
                </div>
              </div>

              {/* Sources (Bento style) */}
              {m.sources && m.sources.length > 0 && (
                <div className="mt-3 w-full flex flex-col items-start">
                  <button
                    type="button"
                    onClick={() => toggleSources(i)}
                    className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest opacity-50 hover:opacity-100 transition-opacity mb-2 bg-app-muted px-2 py-1 rounded-md"
                  >
                    {expandedSources[i] ? (
                      <ChevronUp size={12} />
                    ) : (
                      <ChevronDown size={12} />
                    )}
                    {m.sources.length} Sources Analyzed
                  </button>

                  <AnimatePresence>
                    {expandedSources[i] && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden w-full"
                      >
                        <div className="flex gap-3 overflow-x-auto pb-3 pt-1 custom-scrollbar w-full snap-x">
                          {m.sources.map((source, idx) => (
                            <div
                              key={idx}
                              className="shrink-0 w-64 bg-app-card border border-app-ink/10 p-3 rounded-xl shadow-sm snap-start flex flex-col gap-2"
                            >
                              <div className="flex justify-between items-center text-[10px] opacity-60">
                                <span className="font-bold truncate">
                                  @{source.channelName}
                                </span>
                                <span className="font-mono shrink-0">
                                  {new Date(
                                    source.timestamp,
                                  ).toLocaleDateString()}
                                </span>
                              </div>
                              <p className="text-[11px] line-clamp-3 opacity-80 leading-relaxed">
                                {source.text}
                              </p>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </div>
        ))}

        {isChatting && (
          <div className="flex gap-4 flex-row group/message">
            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm bg-blue-500/10 text-blue-600 border border-blue-500/20">
              <Sparkles size={14} />
            </div>
            <div className="bg-app-card border border-app-ink/10 rounded-2xl rounded-tl-sm shadow-sm p-4 flex items-center gap-3">
              <Loader2 size={14} className="animate-spin opacity-50" />
              <span className="text-[11px] font-mono uppercase tracking-widest opacity-50">
                Analyzing...
              </span>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input Composer */}
      <div className="pt-2 shrink-0">
        <div className="bg-app-card border border-app-ink/10 rounded-2xl shadow-sm p-1.5 flex items-end gap-2 focus-within:border-app-ink/30 focus-within:ring-4 focus-within:ring-app-ink/5 transition-all">
          <textarea
            ref={chatInputRef}
            rows={1}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSendMessage()
              }
            }}
            placeholder="Ask about trends, specific topics, or summarize selected channels..."
            className="flex-1 bg-transparent border-none p-3 text-[13px] focus:outline-none resize-none min-h-[44px] max-h-[200px] custom-scrollbar"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <TgButton
                type="button"
                variant="primary"
                size="md"
                onClick={handleSendMessage}
                disabled={!chatInput.trim()}
                loading={isChatting}
                aria-label="Send Message"
                className="size-11 shrink-0 rounded-xl p-0 mb-0.5 mr-0.5"
              >
                {isChatting ? null : <Send size={18} />}
              </TgButton>
            </TooltipTrigger>
            <TooltipContent>
              <p>Send Message</p>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex justify-between items-center mt-2 px-2">
          <span className="text-[9px] opacity-40 font-mono uppercase tracking-widest">
            Enter to send, Shift+Enter for new line
          </span>
          <span className="text-[9px] opacity-40 font-mono uppercase tracking-widest">
            AI can make mistakes. Verify info.
          </span>
        </div>
      </div>
    </motion.div>
  )
}
