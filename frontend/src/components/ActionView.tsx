import { Compass, FileText, MessageSquare, Send, Tag } from "lucide-react"
import { motion } from "motion/react"
import type React from "react"
import { useState } from "react"

import { RunSettingsBar } from "@/components/action/RunSettingsBar"
import { PasteTagsModal } from "@/components/PasteTagsModal"
import { SummaryConfig } from "@/components/SummaryConfig"
import { TagConfig } from "@/components/TagConfig"
import { TgButton } from "@/components/ui/tg-button"
import { useChatContext } from "@/contexts/ChatContext"
import { useSettings } from "@/contexts/SettingsContext"
import { useTagContext } from "@/contexts/TagContext"
import { useUI } from "@/contexts/UIContext"
import { useApiStatus } from "@/hooks/useApiStatus"
import { useDiscoverGenerate } from "@/hooks/useDiscoverGenerate"
import type { ChatMode } from "@/types"

interface ActionCardProps {
  icon: React.ReactNode
  title: string
  description: string
  children: React.ReactNode
}

const ActionCard: React.FC<ActionCardProps> = ({
  icon,
  title,
  description,
  children,
}) => (
  <section className="rounded-xl border border-app-ink/10 bg-app-card p-5 shadow-sm">
    <header className="mb-4 flex items-start gap-3">
      <span className="mt-0.5 opacity-50">{icon}</span>
      <div>
        <h3 className="text-sm font-bold uppercase tracking-tight">{title}</h3>
        <p className="mt-0.5 text-[11px] text-app-ink/60">{description}</p>
      </div>
    </header>
    {children}
  </section>
)

/**
 * The one place you start work.
 *
 * Each of the four AI features used to own both its create form and its result
 * view, so making something meant knowing which of four tabs to open first.
 * The create halves live here now; the feature tabs render results only.
 *
 * The forms are the *same components* the feature tabs used, moved rather than
 * reimplemented — `SummaryConfig` was already prop-less and `TagConfig` took a
 * single callback, so both work unchanged inside `TgProviders`. Discover needed
 * a seam, which is `useDiscoverGenerate`.
 *
 * Chat has an input in both places, and that is not duplication. A chat only
 * exists once someone has asked something, so the create form *is* a message
 * box; the composer on the Chat tab then carries the conversation on, where it
 * has to stay for autoscroll and focus to work against the transcript.
 *
 * Model and language sit above all four in `RunSettingsBar` rather than inside
 * the Summary card, because three of the four read the same two settings.
 * Discover reads neither — its report is a server-side aggregation with no
 * inference in it.
 */
export const ActionView: React.FC = () => {
  const { setActiveTab, setCurrentChatSessionId } = useUI()
  const {
    chatMode,
    setChatMode,
    setChatInput,
    setChatMessages,
    handleSendMessage,
    isChatting,
  } = useChatContext()
  const { embeddingsEnabled } = useSettings()
  const { completePendingTagRun } = useTagContext()
  const { isOffline } = useApiStatus()
  const { generate, isGenerating, channelCount } = useDiscoverGenerate()

  const [pasteOpen, setPasteOpen] = useState(false)
  const [chatDraft, setChatDraft] = useState("")

  /**
   * Generate a report, then go and look at it.
   *
   * `generate()` pins the new report in `?report=` but does not navigate, so
   * without this the button returns to "Generate report" and nothing visibly
   * happens — the result is sitting on a tab you are not on. The summary path
   * already hops (`AIContext` calls `setActiveTab("summary")`), and four create
   * paths that disagree about whether they show you the result is worse than
   * any one of the behaviours.
   */
  const generateAndShow = async () => {
    await generate()
    setActiveTab("discover")
  }

  /**
   * Save a pasted tag response, then go and review it.
   *
   * The suggestions render on the Tag tab; pasting happens here. Without the
   * hop the modal closes and nothing visibly happens — the same gap the
   * Discover button had, and the summary path has always hopped.
   */
  const savePastedTags = async (text: string, modelName?: string) => {
    const ok = await completePendingTagRun(text, modelName)
    if (ok) setActiveTab("tag")
    return ok
  }

  /**
   * Open a conversation with its first question already asked.
   *
   * A chat only exists once someone has said something, so starting one from
   * here means typing that first message here — the Chat tab then carries the
   * conversation on from its own composer.
   *
   * The three explicit arguments are the point. Clearing the transcript and the
   * session id is not enough on its own: `handleSendMessage` reads both from
   * state captured before this render, so it would send the new question after
   * the last conversation's turns and save the result *over* that
   * conversation's transcript. Saying `[]` and `null` outright is the only
   * version that cannot race the re-render.
   */
  const startChat = () => {
    const question = chatDraft.trim()
    if (!question || isChatting) return
    setChatDraft("")
    setChatInput("")
    setChatMessages([])
    setCurrentChatSessionId(null)
    setActiveTab("chat")
    void handleSendMessage({ message: question, history: [], sessionId: null })
  }

  return (
    <motion.div
      key="action"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-4"
    >
      <RunSettingsBar />

      <ActionCard
        icon={<FileText size={16} />}
        title="Summarize"
        description="AI prose over every post in the current scope."
      >
        <SummaryConfig />
      </ActionCard>

      <ActionCard
        icon={<Tag size={16} />}
        title="Tag channels"
        description="Propose tags for the selected channels, then review before applying."
      >
        <TagConfig onPasteClick={() => setPasteOpen(true)} />
      </ActionCard>

      <ActionCard
        icon={<Compass size={16} />}
        title="Discover channels"
        description="Find the channels your channels keep pointing at."
      >
        <div className="flex flex-wrap items-center justify-end gap-3">
          <TgButton
            data-testid="action-generate-report"
            disabled={isGenerating || isOffline || channelCount === 0}
            onClick={() => void generateAndShow()}
          >
            {isGenerating ? "Generating…" : "Generate report"}
          </TgButton>
        </div>
      </ActionCard>

      <ActionCard
        icon={<MessageSquare size={16} />}
        title="Chat"
        description="Ask questions instead of generating a document. The first message opens the conversation."
      >
        <div className="flex flex-col gap-3">
          <textarea
            data-testid="action-chat-input"
            rows={2}
            value={chatDraft}
            onChange={(e) => setChatDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                startChat()
              }
            }}
            placeholder="Ask about trends, specific topics, or the channels in scope…"
            className="w-full resize-none rounded-xl border border-app-ink/10 bg-app-muted/20 p-3 text-[13px] transition-all focus:border-app-ink/30 focus:outline-none focus:ring-4 focus:ring-app-ink/5"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-lg border border-app-ink/10 bg-app-muted p-1">
              {(
                [
                  ["full_scope", "Full scope"],
                  ["semantic", "Semantic"],
                ] as [ChatMode, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={chatMode === value}
                  disabled={value === "semantic" && !embeddingsEnabled}
                  onClick={() => setChatMode(value)}
                  className={`rounded-md px-3 py-1.5 text-[10px] font-bold uppercase tracking-tight transition-all disabled:opacity-30 ${
                    chatMode === value
                      ? "bg-app-card text-app-ink shadow-sm"
                      : "text-app-ink opacity-60 hover:opacity-100"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <TgButton
              data-testid="action-start-chat"
              onClick={startChat}
              disabled={!chatDraft.trim() || isChatting || isOffline}
              loading={isChatting}
              loadingLabel="Starting…"
            >
              <Send size={13} />
              Start a chat
            </TgButton>
          </div>
        </div>
      </ActionCard>

      <PasteTagsModal
        isOpen={pasteOpen}
        onClose={() => setPasteOpen(false)}
        onSave={savePastedTags}
      />
    </motion.div>
  )
}
