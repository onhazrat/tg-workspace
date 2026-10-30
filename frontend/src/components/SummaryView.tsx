import { motion } from "motion/react"
import type React from "react"
import { useMemo, useState } from "react"
import ReactMarkdown from "react-markdown"
import { toast } from "sonner"
import { ArtifactScopeLine } from "@/components/ArtifactScopeLine"
import { runGated } from "@/components/complete-window/Gate"
import { GoToActionEmptyState } from "@/components/history/GoToActionEmptyState"
import { usePostsViewEdits } from "@/contexts/PostsViewContext"
import { useAiKeys } from "@/hooks/useAiKeys"
import {
  useInvalidateSummaries,
  useSummariesHistory,
  useSummaryAttempts,
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
import { usePreviewWorkspace } from "./PostPreview"
import { CutShortRetry } from "./summary-view/CutShortMark"
import {
  AttemptsFold,
  FailedSummaryPanel,
} from "./summary-view/FailedSummaryPanel"
import { RetryRunWith, useRetryChoice } from "./summary-view/RetryRunWith"
import { SummaryBody } from "./summary-view/SummaryBody"
import {
  CitationRendererProvider,
  summaryMarkdownComponents,
} from "./summary-view/SummaryMarkdown"
import { SummaryPublishPanel } from "./summary-view/SummaryPublishPanel"
import { readerZone, summaryViewState } from "./summary-view/summary-view-model"
import { generatesOnTab } from "./workspace-shell/workspace-shell-model"

export const SummaryView: React.FC = () => {
  const {
    summary,
    generateBackgroundSummary,
    regeneratingSummaries,
    completePendingSummary,
  } = useAI()
  const { isOffline } = useApiStatus()
  const summariesHistory = useSummariesHistory()
  const loadHistory = useInvalidateSummaries()
  const { currentSummaryId, summarizing: runInFlight, setActiveTab } = useUI()
  // The run fills the new-Summary tab; another Summary's tab is not generating.
  const summarizing = generatesOnTab({
    summarizing: runInFlight,
    activeTab: "summary",
    summaryId: currentSummaryId,
  })
  const settings = useSettings()
  const zone = readerZone(settings.timeZone)

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
      covered: currentSummaryDetail?.scope?.posts,
    }),
    [refs, resolve, citedLoading, currentSummaryId, currentSummaryDetail],
  )

  const {
    currentSummary,
    summaryBody,
    isPending,
    isFailed,
    pasteTarget,
    running,
  } = summaryViewState({
    history: summariesHistory,
    currentSummaryId,
    detail: currentSummaryDetail,
    streamed: summary,
    regenerating: regeneratingSummaries,
    summarizing,
  })
  const { attempts, runningText, retry, stop, cancel, keep, dismiss, restore } =
    useSummaryAttempts(currentSummaryId, settings.aiTemperature)
  const runningAttempt = attempts.find((a) => a.outcome === "running")
  const aiKeys = useAiKeys()
  const keyLabel = (id: string | null) => aiKeys.find((k) => k.id === id)?.label
  const [retryChoice, setRetryChoice] = useRetryChoice(
    currentSummaryId,
    attempts,
    currentSummary?.model ?? "",
  )
  const applyScope = usePostsViewEdits().restore

  const workspace = usePreviewWorkspace()
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
      // A new Summary goes through the gate on the Action tab (CW-02).
      setActiveTab("action")
      runGated("summary")
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
          isFailed={isFailed}
          failurePanel={(s) => (
            <FailedSummaryPanel
              summary={s}
              promptText={currentSummaryDetail?.promptText}
              attempts={attempts}
              zone={zone}
              keyLabel={keyLabel}
              onPaste={() => setPasteModalOpen(true)}
              runningText={runningText}
              onRetry={() => void retry(s.id, retryChoice)}
              runWith={
                <RetryRunWith
                  value={retryChoice}
                  onChange={setRetryChoice}
                  attempts={attempts}
                  promptText={currentSummaryDetail?.promptText}
                />
              }
              onStop={(attemptId) => void stop(s.id, attemptId)}
              onCancel={(attemptId) => void cancel(s.id, attemptId)}
              onKeep={(attemptId) => void keep(s.id, attemptId)}
              onDismiss={(attemptId) => void dismiss(s.id, attemptId)}
              onRestore={(attemptId) => void restore(s.id, attemptId)}
              onChangeSelection={() => {
                if (s.scope) applyScope(s.scope)
                setActiveTab("action")
              }}
            />
          )}
          attemptsFold={
            <AttemptsFold attempts={attempts} keyLabel={keyLabel} />
          }
          cutShortMark={
            // Rendered by `SummaryBody` only for an open Cut short Summary.
            <CutShortRetry
              attempt={runningAttempt}
              text={runningText}
              keyLabel={keyLabel}
              onRetry={() => currentSummaryId && void retry(currentSummaryId)}
              onStop={(attemptId) =>
                currentSummaryId && void stop(currentSummaryId, attemptId)
              }
            />
          }
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
            <CitationRendererProvider
              resolve={resolve}
              loading={citedLoading}
              workspace={workspace}
            >
              <ReactMarkdown components={summaryMarkdownComponents}>
                {markdown}
              </ReactMarkdown>
            </CitationRendererProvider>
          )}
          scopeLine={(artifact, className) => (
            <ArtifactScopeLine
              artifact={artifact}
              missingPosts={artifact.missingPosts}
              className={className}
            />
          )}
          cited={cited}
          workspace={workspace}
          textSize={settings.summaryTextSize}
          onTextSizeChange={settings.setSummaryTextSize}
          zone={zone}
          emptyState={
            <GoToActionEmptyState
              what="summary"
              description="Summaries are made on the Action tab, from the channels and Analysis window in scope there. Open a past one from History, or generate a new one."
            />
          }
        />
      </div>

      {pasteTarget && (
        <PasteSummaryModal
          isOpen={pasteModalOpen}
          onClose={() => setPasteModalOpen(false)}
          onSave={(text, modelName) =>
            completePendingSummary(pasteTarget.id, text, modelName)
          }
        />
      )}
    </motion.div>
  )
}
