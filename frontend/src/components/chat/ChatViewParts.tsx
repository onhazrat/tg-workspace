/**
 * The pieces the Chat tab is assembled from. Each takes props only; `ChatView`
 * keeps the contexts, the copy timer and the clear.
 */
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
} from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import type React from "react"
import ReactMarkdown from "react-markdown"
import { TgButton } from "@/components/ui/tg-button"
import { TgIconButton } from "@/components/ui/tg-icon-button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tg-tooltip"
import { LANGUAGES } from "@/constants"
import { replaceCitations } from "@/lib/citations/replace-citations"
import { renderPostText } from "@/lib/posts/render-post-text"
import type { ChatMessage, ChatMode, Post } from "@/types"
import { citedSource, turnProseClass } from "./chat-view-model"

const modeButtonClass = (active: boolean) =>
  `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-tight transition-all ${
    active
      ? "bg-app-card text-app-ink shadow-sm"
      : "text-app-ink opacity-60 hover:opacity-100 hover:bg-app-ink/5"
  }`

/** Full Scope, and Semantic only where embeddings are on. */
export const ChatModeToggle: React.FC<{
  chatMode: ChatMode
  onChange: (mode: ChatMode) => void
  embeddingsEnabled: boolean
}> = ({ chatMode, onChange, embeddingsEnabled }) => (
  <div className="flex items-center bg-app-muted rounded-lg p-1 border border-app-ink/10">
    <button
      type="button"
      onClick={() => onChange("full_scope")}
      className={modeButtonClass(chatMode === "full_scope")}
    >
      <FileText size={12} />
      Full Scope
    </button>
    {embeddingsEnabled && (
      <button
        type="button"
        onClick={() => onChange("semantic")}
        className={modeButtonClass(chatMode === "semantic")}
      >
        <Database size={12} />
        Semantic
      </button>
    )}
  </div>
)

/** The answer language, and a slot for the model picker beside it. */
export const ChatLanguageAndModel: React.FC<{
  aiLanguage: string
  onLanguageChange: (language: string) => void
  modelPicker: React.ReactNode
}> = ({ aiLanguage, onLanguageChange, modelPicker }) => (
  <div className="flex items-center gap-3 border-l border-app-ink/10 pl-4">
    <div className="flex items-center gap-2">
      <span className="text-[9px] uppercase font-bold opacity-40">Lang:</span>
      <select
        value={aiLanguage}
        onChange={(e) => onLanguageChange(e.target.value)}
        className="bg-transparent border-none py-0 focus:outline-none text-[10px] font-bold uppercase tracking-tight cursor-pointer hover:opacity-100 opacity-80 transition-opacity"
      >
        {LANGUAGES.map((l) => (
          <option key={l} value={l} className="bg-app-card text-app-ink">
            {l}
          </option>
        ))}
      </select>
    </div>
    <div className="flex items-center gap-2 border-l border-app-ink/10 pl-3">
      <span className="text-[9px] uppercase font-bold opacity-40">Model:</span>
      {modelPicker}
    </div>
  </div>
)

/** Whether the embedding index is still catching up; nothing when embeddings are off. */
export const EmbeddingsStatus: React.FC<{
  embeddingsEnabled: boolean
  isSyncing: boolean
  progress: { current: number; total: number }
}> = ({ embeddingsEnabled, isSyncing, progress }) => {
  if (!embeddingsEnabled) return null
  if (!isSyncing)
    return (
      <div className="flex items-center gap-2 text-[9px] uppercase font-bold text-green-500 bg-green-500/10 px-2 py-1 rounded-md">
        <Check size={12} />
        Embeddings Ready
      </div>
    )
  return (
    <div className="flex items-center gap-2 text-[9px] uppercase font-bold text-blue-500 bg-blue-500/10 px-2 py-1 rounded-md">
      <Loader2 size={12} className="animate-spin" />
      {progress.total > 0
        ? `Syncing (${progress.current}/${progress.total})`
        : "Checking..."}
    </div>
  )
}

/** Copy and clear, once there is a conversation to copy or clear. */
export const ChatHistoryActions: React.FC<{
  hasTurns: boolean
  copied: boolean
  onCopy: () => void
  onClear: () => void
}> = ({ hasTurns, copied, onCopy, onClear }) => {
  if (!hasTurns) return null
  return (
    <>
      <TgIconButton
        aria-label="Copy Chat History"
        tooltip="Copy Chat History"
        onClick={onCopy}
        className="text-app-ink/40"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </TgIconButton>
      <TgIconButton
        aria-label="Clear Conversation"
        tooltip="Clear Conversation"
        onClick={onClear}
        className="text-app-ink/40 hover:text-red-500 hover:bg-red-500/10"
      >
        <Plus size={14} className="rotate-45" />
      </TgIconButton>
    </>
  )
}

/** One source card under a model turn. */
const SourceCard: React.FC<{ source: Post }> = ({ source }) => (
  <div className="shrink-0 w-64 bg-app-card border border-app-ink/10 p-3 rounded-xl shadow-sm snap-start flex flex-col gap-2">
    <div className="flex justify-between items-center text-[10px] opacity-60">
      <span className="font-bold truncate">@{source.channelName}</span>
      <span className="font-mono shrink-0">
        {new Date(source.timestamp).toLocaleDateString()}
      </span>
    </div>
    <p className="text-[11px] line-clamp-3 opacity-80 leading-relaxed">
      {renderPostText(source.text, "", source.linkSpans)}
    </p>
  </div>
)

/** The "N Sources Analyzed" toggle and the cards it opens. */
export const ChatTurnSources: React.FC<{
  sources: Post[]
  open: boolean
  onToggle: () => void
}> = ({ sources, open, onToggle }) => (
  <div className="mt-3 w-full flex flex-col items-start">
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest opacity-50 hover:opacity-100 transition-opacity mb-2 bg-app-muted px-2 py-1 rounded-md"
    >
      {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      {sources.length} Sources Analyzed
    </button>

    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden w-full"
        >
          <div className="flex gap-3 overflow-x-auto pb-3 pt-1 custom-scrollbar w-full snap-x">
            {sources.map((source, idx) => (
              <SourceCard key={idx} source={source} />
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
)

const USER_TURN = {
  row: "flex-row-reverse",
  avatar: "bg-app-ink text-app-bg",
  column: "items-end",
  bubble: "bg-app-ink text-app-bg rounded-2xl rounded-tr-sm shadow-md",
  copy: "-left-3 bg-app-card text-app-ink border border-app-ink/10",
}
const MODEL_TURN = {
  row: "flex-row",
  avatar: "bg-blue-500/10 text-blue-600 border border-blue-500/20",
  column: "items-start",
  bubble:
    "bg-app-card border border-app-ink/10 rounded-2xl rounded-tl-sm shadow-sm",
  copy: "-right-3 bg-app-ink text-app-bg",
}

/** One turn: the avatar, the Markdown bubble with its citations, and its sources. */
export const ChatTurn: React.FC<{
  message: ChatMessage
  sourcesOpen: boolean
  onToggleSources: () => void
  onCopy: (text: string) => void
  isRTL: boolean
  theme: string
  aiLanguage: string
}> = ({
  message: m,
  sourcesOpen,
  onToggleSources,
  onCopy,
  isRTL,
  theme,
  aiLanguage,
}) => {
  const isUser = m.role === "user"
  const look = isUser ? USER_TURN : MODEL_TURN
  const cite = (channelName: string, postId: number) =>
    citedSource(m.sources, channelName, postId)
  return (
    <div className={`flex gap-4 ${look.row} group/message`}>
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${look.avatar}`}
      >
        {isUser ? <User size={14} /> : <Sparkles size={14} />}
      </div>

      <div
        className={`relative max-w-[85%] sm:max-w-[75%] flex flex-col ${look.column}`}
      >
        <div
          className={`p-4 text-[13px] leading-relaxed relative group/bubble ${look.bubble}`}
        >
          <TgIconButton
            aria-label="Copy message"
            tooltip="Copy message"
            onClick={() => onCopy(m.text)}
            className={`absolute -top-3 shadow-sm opacity-0 group-hover/bubble:opacity-100 focus-visible:opacity-100 ${look.copy}`}
          >
            <Copy size={12} />
          </TgIconButton>

          <div
            dir={isRTL ? "rtl" : "ltr"}
            className={turnProseClass(m.role, theme, isRTL, aiLanguage)}
          >
            <ReactMarkdown
              components={{
                p: ({ node, children, ...props }) => (
                  <p {...props}>{replaceCitations(children, cite)}</p>
                ),
                li: ({ node, children, ...props }) => (
                  <li {...props}>{replaceCitations(children, cite)}</li>
                ),
              }}
            >
              {m.text}
            </ReactMarkdown>
          </div>
        </div>

        {m.sources && m.sources.length > 0 && (
          <ChatTurnSources
            sources={m.sources}
            open={sourcesOpen}
            onToggle={onToggleSources}
          />
        )}
      </div>
    </div>
  )
}

/** The model's bubble while a reply is on its way; nothing otherwise. */
export const ChatThinking: React.FC<{ active: boolean }> = ({ active }) =>
  active && (
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
  )

/** The input and send button. Enter sends; Shift+Enter is a new line. */
export const ChatComposer: React.FC<{
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  isChatting: boolean
  inputRef: React.Ref<HTMLTextAreaElement>
}> = ({ input, onInputChange, onSend, isChatting, inputRef }) => (
  <div className="pt-2 shrink-0">
    <div className="bg-app-card border border-app-ink/10 rounded-2xl shadow-sm p-1.5 flex items-end gap-2 focus-within:border-app-ink/30 focus-within:ring-4 focus-within:ring-app-ink/5 transition-all">
      <textarea
        ref={inputRef}
        rows={1}
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            onSend()
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
            onClick={onSend}
            disabled={!input.trim()}
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
)
