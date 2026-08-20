import { Compass, FileText, MessageSquare, Tag } from "lucide-react"
import { motion } from "motion/react"
import type React from "react"
import { useState } from "react"

import { PasteTagsModal } from "@/components/PasteTagsModal"
import { SummaryConfig } from "@/components/SummaryConfig"
import { TagConfig } from "@/components/TagConfig"
import { TgButton } from "@/components/ui/tg-button"
import { useChatContext } from "@/contexts/ChatContext"
import { useData } from "@/contexts/DataContext"
import { useSettings } from "@/contexts/SettingsContext"
import { useTagContext } from "@/contexts/TagContext"
import { useUI } from "@/contexts/UIContext"
import { useApiStatus } from "@/hooks/useApiStatus"
import { useDiscoverGenerate } from "@/hooks/useDiscoverGenerate"
import { useScopedPostCounts } from "@/hooks/usePostsView"
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
 * Chat is the exception and gets a launcher rather than a form. Its composer
 * *is* its result view — input and transcript have to be co-located for
 * autoscroll and focus to work — so moving it here would break both for nothing.
 */
export const ActionView: React.FC = () => {
  const { selectedChannels } = useData()
  const { setActiveTab, setCurrentChatSessionId } = useUI()
  const { chatMode, setChatMode, setChatInput, setChatMessages, chatInputRef } =
    useChatContext()
  const { embeddingsEnabled } = useSettings()
  const { completePendingTagRun } = useTagContext()
  const { isOffline } = useApiStatus()
  const { generate, isGenerating, channelCount } = useDiscoverGenerate()

  const [pasteOpen, setPasteOpen] = useState(false)

  const counts = useScopedPostCounts()
  const postsInScope = Object.values(counts).reduce((sum, n) => sum + n, 0)

  const scopeLine = `${selectedChannels.size} channel${
    selectedChannels.size === 1 ? "" : "s"
  } · ${postsInScope.toLocaleString()} posts in scope`

  /**
   * Start a *new* conversation, not continue the last one.
   *
   * Clearing both the transcript and `currentChatSessionId` is the whole point:
   * `handleSendMessage` reuses that id, and the payload write replaces
   * `messages` wholesale — so leaving it set would overwrite the previous
   * chat's transcript with the first turn of this one.
   */
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

  const startChat = () => {
    setChatInput("")
    setChatMessages([])
    setCurrentChatSessionId(null)
    setActiveTab("chat")
    // The composer owns focus once it mounts; this is the hand-off.
    window.setTimeout(() => chatInputRef.current?.focus(), 0)
  }

  return (
    <motion.div
      key="action"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-4"
    >
      <p
        data-testid="action-scope"
        className="font-mono text-[11px] uppercase tracking-widest text-app-ink/50"
      >
        {scopeLine}
      </p>

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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-mono text-[11px] uppercase tracking-widest text-app-ink/50">
            {channelCount} channel{channelCount === 1 ? "" : "s"} scanned
          </span>
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
        description="Ask questions instead of generating a document."
      >
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
          <TgButton data-testid="action-start-chat" onClick={startChat}>
            Start a chat
          </TgButton>
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
