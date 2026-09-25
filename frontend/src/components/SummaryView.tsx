import { motion } from "motion/react"
import type React from "react"
import { useEffect, useState } from "react"
import ReactMarkdown from "react-markdown"
import { toast } from "sonner"
import { ArtifactScopeLine } from "@/components/ArtifactScopeLine"
import { GoToActionEmptyState } from "@/components/history/GoToActionEmptyState"
import { useBotCredentials, useChatDestinations } from "@/hooks/useBots"
import {
  useInvalidateSummaries,
  useSummariesHistory,
} from "@/hooks/useSummaries"
import { saveSummary } from "@/lib/summaries/store"
import { summaryMetadataText } from "@/lib/summaries/summary-model"
import { useAI } from "../contexts/AIContext"
import { useSettings } from "../contexts/SettingsContext"
import { useUI } from "../contexts/UIContext"
import { useApiStatus } from "../hooks/useApiStatus"
import { useSummaryDetailQuery } from "../hooks/useSummaries"
import { reportDirection } from "../lib/report-direction"
import type { Summary } from "../types"
import { PasteSummaryModal } from "./PasteSummaryModal"
import { SummaryBody } from "./summary-view/SummaryBody"
import { summaryMarkdownComponents } from "./summary-view/SummaryMarkdown"
import {
  publishFromView,
  summaryViewState,
} from "./summary-view/summary-view-model"

export const SummaryView: React.FC = () => {
  const {
    summary,
    handleSummarize,
    generateBackgroundSummary,
    regeneratingSummaries,
    completePendingSummary,
  } = useAI()
  const { isOffline } = useApiStatus()
  const botCredentials = useBotCredentials()
  const chatDestinations = useChatDestinations()
  const summariesHistory = useSummariesHistory()
  const loadHistory = useInvalidateSummaries()
  const { currentSummaryId, summarizing } = useUI()
  const settings = useSettings()

  // The prompt panel below needs the full promptText, which the list
  // projection omits (it was ~94% of that payload).
  const { data: currentSummaryDetail } = useSummaryDetailQuery(currentSummaryId)

  const { currentSummary, summaryBody, isPending, running } = summaryViewState({
    history: summariesHistory,
    currentSummaryId,
    detail: currentSummaryDetail,
    streamed: summary,
    regenerating: regeneratingSummaries,
    summarizing,
  })

  const [pasteModalOpen, setPasteModalOpen] = useState(false)
  const [isEditingNote, setIsEditingNote] = useState(false)
  const [sendMetadata, setSendMetadata] = useState(true)
  const [metadataText, setMetadataText] = useState("")

  useEffect(() => {
    if (!currentSummary) return
    setSendMetadata(currentSummary.sendMetadata !== false)
    setMetadataText(summaryMetadataText(currentSummary))
  }, [currentSummary])

  // Read from the loaded record, so a saved report renders in its own language
  // without having to overwrite the user's setting for the next generation.
  const bodyDirection = reportDirection(
    currentSummary?.language,
    settings.aiLanguage,
  )
  const metadataToSend = sendMetadata ? metadataText : null

  const saveCurrent = async (patch: Partial<Summary>) => {
    if (!currentSummary) return
    await saveSummary({ ...currentSummary, ...patch })
    await loadHistory()
  }

  const handleRerun = () => {
    if (isOffline) {
      toast.warning("Server offline — summary generation disabled.")
      return
    }
    if (!currentSummary) {
      handleSummarize()
      return
    }
    toast.promise(generateBackgroundSummary(currentSummary, false), {
      loading: "Re-analyzing current time window...",
      success: "Analysis re-run successfully.",
      error: "Failed to re-run analysis.",
    })
  }

  return (
    <motion.div
      key="summary"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* The card is chrome and stays LTR. Direction is applied to the generated
          body below — when it lived here, English chrome inherited RTL from a
          Persian report and rendered its trailing period on the wrong side. */}
      <div className="relative border border-app-ink/10 bg-app-card rounded-xl p-8 md:p-12 shadow-sm">
        <SummaryBody
          summary={currentSummary}
          promptText={currentSummaryDetail?.promptText}
          body={summaryBody}
          isPending={isPending}
          summarizing={summarizing}
          running={running}
          direction={bodyDirection}
          bots={botCredentials}
          destinations={chatDestinations}
          onPublish={(bot, dest, text) =>
            publishFromView({
              bot,
              dest,
              text,
              summaryId: currentSummaryId,
              metadata: metadataToSend,
              isOffline,
              settings,
            })
          }
          onRerun={handleRerun}
          onPaste={() => setPasteModalOpen(true)}
          editingNote={isEditingNote}
          onEditingNoteChange={setIsEditingNote}
          onSaveNote={async (note) => {
            await saveCurrent({ note })
            setIsEditingNote(false)
            toast.success("Note saved.")
          }}
          onDeleteNote={async () => {
            await saveCurrent({ note: undefined })
            setIsEditingNote(false)
            toast.success("Note deleted.")
          }}
          sendMetadata={sendMetadata}
          metadataText={metadataText}
          metadataToSend={metadataToSend}
          onSendMetadataChange={(send) => {
            setSendMetadata(send)
            void saveCurrent({ sendMetadata: send })
          }}
          onMetadataTextChange={setMetadataText}
          onSaveMetadata={async (text) => {
            await saveCurrent({ metadataText: text })
            toast.success("Metadata updated.")
          }}
          markdown={
            <ReactMarkdown components={summaryMarkdownComponents}>
              {summaryBody}
            </ReactMarkdown>
          }
          scopeLine={(artifact, className) => (
            <ArtifactScopeLine artifact={artifact} className={className} />
          )}
          emptyState={
            <GoToActionEmptyState
              what="summary"
              description="Summaries are made on the Action tab, from the channels and Analysis window in scope there. Open a past one from History, or generate a new one."
            />
          }
        />
      </div>

      {currentSummary && isPending && (
        <PasteSummaryModal
          isOpen={pasteModalOpen}
          onClose={() => setPasteModalOpen(false)}
          onSave={(text, modelName) =>
            completePendingSummary(currentSummary.id, text, modelName)
          }
        />
      )}
    </motion.div>
  )
}
