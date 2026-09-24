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
import { savePublishLog } from "@/lib/logs/write"
import { saveSummary } from "@/lib/summaries/store"
import {
  publishedText,
  summaryMetadataText,
} from "@/lib/summaries/summary-model"
import { buildActiveProxies } from "@/lib/syncSettings"
import { isPendingSummary } from "../constants"
import { useAI } from "../contexts/AIContext"
import { useSettings } from "../contexts/SettingsContext"
import { useUI } from "../contexts/UIContext"
import { useApiStatus } from "../hooks/useApiStatus"
import { useSummaryDetailQuery } from "../hooks/useSummaries"
import { reportDirection } from "../lib/report-direction"
import { publishSummary } from "../services/telegram"
import type { BotCredential, ChatDestination, Summary } from "../types"
import { PasteSummaryModal } from "./PasteSummaryModal"
import { PublishMetadataPanel } from "./summary-view/PublishMetadataPanel"
import { summaryMarkdownComponents } from "./summary-view/SummaryMarkdown"
import { SummaryNote } from "./summary-view/SummaryNote"
import {
  GeneratingSkeleton,
  PendingSummaryPanel,
  SummaryCounts,
  SummaryMetaChips,
} from "./summary-view/SummaryParts"
import {
  ExportButtons,
  NoteToggleButton,
  PublishControls,
  RerunButton,
  TelegramLengthHint,
} from "./summary-view/SummaryToolbar"
import { telegramMessageLength } from "./summary-view/summary-text"

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

  /*
   * Prefer the list row, fall back to the detail fetch.
   *
   * Reading only from `summariesHistory` made opening a summary from History
   * depend on that list happening to be loaded and to contain the row — which
   * is not something History guarantees any more, since it lists artifacts
   * through `/data/artifacts` rather than through the summaries query. The
   * detail fetch is keyed on the id in the URL, so it always has the answer.
   */
  const currentSummary =
    summariesHistory.find((s) => s.id === currentSummaryId) ??
    currentSummaryDetail

  /*
   * The body: live stream first, saved text second.
   *
   * `summary` is `AIContext`'s streaming buffer — only ever set by generating
   * or pasting. Opening a saved summary used to fill it from the restore path
   * in `App.tsx`; deleting that path left this view rendering nothing for every
   * artifact opened from History, which is exactly what it looked like. Falling
   * back to the stored text means the view works from the URL alone.
   */
  const summaryBody = summary ?? currentSummaryDetail?.text ?? null
  const isPending = currentSummary ? isPendingSummary(currentSummary) : false
  const isRegenerating = currentSummary
    ? regeneratingSummaries.has(currentSummary.id)
    : false

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

  const handlePublish = async (
    bot: BotCredential,
    dest: ChatDestination,
    text: string,
  ) => {
    if (isOffline) {
      toast.warning("Server offline — publish disabled.")
      return
    }
    try {
      const result = await publishSummary(
        bot.id,
        dest.chatId,
        text,
        metadataToSend ?? undefined,
        buildActiveProxies(settings).length > 0,
        settings.torAutoRotate,
        settings.torRotationThreshold,
      )
      await savePublishLog({
        id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
        summaryId: currentSummaryId || `manual-${Date.now()}`,
        botId: bot.id,
        botName: bot.name,
        chatId: dest.chatId,
        chatName: dest.name,
        status: result.success ? "success" : "failed",
        error: result.error,
        timestamp: Date.now(),
        fullRequest: result.requests,
        fullResponse: result.responses,
        textSent: publishedText(metadataToSend, text),
      })
      if (result.success)
        toast.success(`Successfully published using ${bot.name}!`)
      else toast.error(`Error publishing: ${result.error}`)
    } catch (e: unknown) {
      toast.error(
        `Error publishing: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  const renderBody = () => {
    if (isPending && currentSummary)
      return (
        <>
          <PendingSummaryPanel
            summary={currentSummary}
            promptText={currentSummaryDetail?.promptText}
            onPaste={() => setPasteModalOpen(true)}
          />
          {/*
           * The frozen Analysis window, exact on both ends and never the
           * workspace's own (AW-08). The workspace one moves; this Summary
           * was made from these two instants and no others.
           */}
          <ArtifactScopeLine artifact={currentSummary} className="mt-3" />
        </>
      )
    if (summaryBody)
      return (
        <>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10 border-b border-app-ink/10 pb-6">
            <div>
              <h3 className="text-2xl font-bold tracking-tight mb-3">
                Analysis Report
              </h3>
              <SummaryMetaChips
                timestamp={currentSummary?.timestamp ?? Date.now()}
                model={currentSummary?.model}
                language={currentSummary?.language}
              />
            </div>
            <div className="flex items-center gap-1.5 bg-app-muted/20 p-1.5 rounded-xl border border-app-ink/5">
              <PublishControls
                bots={botCredentials}
                destinations={chatDestinations}
                onPublish={(bot, dest) => handlePublish(bot, dest, summaryBody)}
              />
              {currentSummary && (
                <NoteToggleButton
                  note={currentSummary.note}
                  editing={isEditingNote}
                  onToggle={() => setIsEditingNote(!isEditingNote)}
                />
              )}
              <RerunButton
                running={summarizing || isRegenerating}
                onRerun={handleRerun}
              />
              <ExportButtons body={summaryBody} />
            </div>
            <TelegramLengthHint
              length={telegramMessageLength(summaryBody, metadataToSend)}
            />
          </div>
          <div
            dir={bodyDirection.dir}
            className={`prose prose-sm md:prose-base max-w-none prose-headings:tracking-tight prose-headings:font-bold prose-p:leading-relaxed prose-p:text-app-ink/80 prose-li:text-app-ink/80 prose-li:my-1 dark:prose-invert ${bodyDirection.className}`}
          >
            <ReactMarkdown components={summaryMarkdownComponents}>
              {summaryBody}
            </ReactMarkdown>
          </div>

          {currentSummary && (
            <>
              <SummaryNote
                note={currentSummary.note}
                editing={isEditingNote}
                onEditingChange={setIsEditingNote}
                onSave={async (note) => {
                  await saveCurrent({ note })
                  setIsEditingNote(false)
                  toast.success("Note saved.")
                }}
                onDelete={async () => {
                  await saveCurrent({ note: undefined })
                  setIsEditingNote(false)
                  toast.success("Note deleted.")
                }}
              />
              <PublishMetadataPanel
                send={sendMetadata}
                text={metadataText}
                savedText={summaryMetadataText(currentSummary)}
                onSendChange={(send) => {
                  setSendMetadata(send)
                  void saveCurrent({ sendMetadata: send })
                }}
                onTextChange={setMetadataText}
                onSave={async (text) => {
                  await saveCurrent({ metadataText: text })
                  toast.success("Metadata updated.")
                }}
              />
              <div className="mt-12 pt-6 border-t border-app-ink/10 flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-2">
                  <SummaryCounts
                    postsLabel={`${currentSummary.postCount} Posts Analyzed`}
                    summary={currentSummary}
                  />
                </div>
                {/*
                 * The Summary's own window, not the workspace's. This read
                 * `startDate`/`endDate` off live Scope until AW-08, so a
                 * Summary generated last week described whatever window Posts
                 * happened to be showing while you read it.
                 */}
                <ArtifactScopeLine artifact={currentSummary} />
              </div>
            </>
          )}
        </>
      )
    if (summarizing) return <GeneratingSkeleton />
    /*
     * A result tab with no result (AW-09).
     *
     * It said "Ready to Summarize" and then described a create path that
     * has not been on this tab since Action took the four forms. Naming
     * where work starts is the same answer Tag, Discover and Chat give.
     */
    return (
      <GoToActionEmptyState
        what="summary"
        description="Summaries are made on the Action tab, from the channels and Analysis window in scope there. Open a past one from History, or generate a new one."
      />
    )
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
        {renderBody()}
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
