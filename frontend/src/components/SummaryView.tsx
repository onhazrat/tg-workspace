import { motion } from "motion/react"
import type React from "react"
import { useMemo, useState } from "react"
import ReactMarkdown from "react-markdown"
import { toast } from "sonner"
import { ArtifactScopeLine } from "@/components/ArtifactScopeLine"
import { GoToActionEmptyState } from "@/components/history/GoToActionEmptyState"
import {
  useInvalidateSummaries,
  useSummariesHistory,
} from "@/hooks/useSummaries"
import { saveSummary } from "@/lib/summaries/store"
import { useAI } from "../contexts/AIContext"
import { useSettings } from "../contexts/SettingsContext"
import { useUI } from "../contexts/UIContext"
import { useApiStatus } from "../hooks/useApiStatus"
import { useCitedPosts } from "../hooks/useCitedPosts"
import { useSummaryDetailQuery } from "../hooks/useSummaries"
import { reportDirection } from "../lib/report-direction"
import type { Summary } from "../types"
import { PasteSummaryModal } from "./PasteSummaryModal"
import { SummaryBody } from "./summary-view/SummaryBody"
import { summaryMarkdownComponents } from "./summary-view/SummaryMarkdown"
import { SummaryPublishPanel } from "./summary-view/SummaryPublishPanel"
import { summaryViewState } from "./summary-view/summary-view-model"
import { generatesOnTab } from "./workspace-shell/workspace-shell-model"

export const SummaryView: React.FC = () => {
  const {
    summary,
    handleSummarize,
    generateBackgroundSummary,
    regeneratingSummaries,
    completePendingSummary,
  } = useAI()
  const { isOffline } = useApiStatus()
  const summariesHistory = useSummariesHistory()
  const loadHistory = useInvalidateSummaries()
  const { currentSummaryId, summarizing: runInFlight } = useUI()
  // The run fills the new-Summary tab; another Summary's tab is not generating.
  const summarizing = generatesOnTab({
    summarizing: runInFlight,
    activeTab: "summary",
    summaryId: currentSummaryId,
  })
  const settings = useSettings()

  // The prompt panel below needs the full promptText, which the list
  // projection omits (it was ~94% of that payload).
  const { data: currentSummaryDetail } = useSummaryDetailQuery(currentSummaryId)

  const {
    refs,
    resolve,
    loading: citedLoading,
  } = useCitedPosts(currentSummaryDetail)
  const cited = useMemo(
    () => ({
      posts: refs.map((r) => resolve(r.channelName, r.postId)),
      // The detail holds the Summary's Citations; until it arrives, loading.
      loading: citedLoading || (!!currentSummaryId && !currentSummaryDetail),
    }),
    [refs, resolve, citedLoading, currentSummaryId, currentSummaryDetail],
  )

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
  // Read from the loaded record, so a saved report renders in its own language
  // without having to overwrite the user's setting for the next generation.
  const bodyDirection = reportDirection(
    currentSummary?.language,
    settings.aiLanguage,
  )

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
          publishPanel={(s) => (
            <SummaryPublishPanel key={s.id} summary={s} onSave={saveCurrent} />
          )}
          renderMarkdown={(markdown) => (
            <ReactMarkdown components={summaryMarkdownComponents}>
              {markdown}
            </ReactMarkdown>
          )}
          scopeLine={(artifact, className) => (
            <ArtifactScopeLine artifact={artifact} className={className} />
          )}
          cited={cited}
          textSize={settings.summaryTextSize}
          onTextSizeChange={settings.setSummaryTextSize}
          zone={{
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }}
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
