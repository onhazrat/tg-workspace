import {
  Check,
  ClipboardPaste,
  Clock,
  Copy,
  Database,
  Download,
  FileText,
  Loader2,
  RefreshCw,
  Send,
  StickyNote,
  Tag,
} from "lucide-react"
import { motion } from "motion/react"
import React, { useState } from "react"
import ReactMarkdown from "react-markdown"
import { toast } from "sonner"
import { TgButton } from "@/components/ui/tg-button"
import { useBotCredentials, useChatDestinations } from "@/hooks/useBots"
import {
  useInvalidateSummaries,
  useSummariesHistory,
} from "@/hooks/useSummaries"
import { savePublishLog } from "@/lib/logs/write"
import { saveSummary } from "@/lib/summaries/store"
import { buildActiveProxies } from "@/lib/syncSettings"
import { formatSummaryModelLabel, isPendingSummary } from "../constants"
import { generateDefaultMetadataText, useAI } from "../contexts/AIContext"
import { useScraper } from "../contexts/ScraperContext"
import { useSettings } from "../contexts/SettingsContext"
import { useUI } from "../contexts/UIContext"
import { useApiStatus } from "../hooks/useApiStatus"
import { useSummaryDetailQuery } from "../hooks/useSummaries"
import { replaceCitations } from "../lib/citations/replace-citations"
import { reportDirection } from "../lib/report-direction"
import { formatDateToLocalISO } from "../lib/utils"
import { publishSummary } from "../services/telegram"
import type { PublishLog, Summary } from "../types"
import { PasteSummaryModal } from "./PasteSummaryModal"
import { RelativeTime } from "./RelativeTime"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tg-tooltip"

const EMPTY_CITED_POSTS: NonNullable<Summary["citedPosts"]> = {}

const extractText = (children: React.ReactNode): string => {
  if (typeof children === "string") return children
  if (typeof children === "number") return children.toString()
  if (Array.isArray(children)) return children.map(extractText).join("")
  if (React.isValidElement(children)) {
    // If it's a list (ul/ol), we don't want to extract its text when clicking a parent node
    if (children.type === "ul" || children.type === "ol") {
      return ""
    }
    // If it's a list item, we don't want to extract its text if it contains a nested list
    if (children.type === "li") {
      const hasNestedList = React.Children.toArray(
        (children.props as any).children,
      ).some(
        (child: any) =>
          React.isValidElement(child) &&
          (child.type === "ul" || child.type === "ol"),
      )
      if (hasNestedList) {
        return ""
      }
    }
    return extractText((children.props as any).children)
  }
  return ""
}

function useCitedPostResolver() {
  const { currentSummaryId } = useUI()
  // citedPosts is not in the list projection — fetch the row being viewed.
  const { data: detail } = useSummaryDetailQuery(currentSummaryId)
  const citedPosts = detail?.citedPosts ?? EMPTY_CITED_POSTS

  return React.useCallback(
    (channelName: string, postId: number) =>
      citedPosts[`${channelName}-${postId}`],
    [citedPosts],
  )
}

const CustomMarkdownP = ({ children, ...props }: any) => {
  const resolvePost = useCitedPostResolver()

  return <p {...props}>{replaceCitations(children, resolvePost)}</p>
}

const CustomMarkdownLi = ({ node, children, ...props }: any) => {
  const { setSemanticSearchQuery } = useScraper()
  const { setActiveTab } = useUI()
  const { embeddingsEnabled } = useSettings()
  const resolvePost = useCitedPostResolver()

  // Find if this li contains a nested list
  const hasNestedList = node?.children?.some(
    (child: any) =>
      child.type === "element" &&
      (child.tagName === "ul" || child.tagName === "ol"),
  )
  const isLeaf = !hasNestedList

  if (!isLeaf) {
    // For parent nodes, just render normally without click handlers
    return <li {...props}>{children}</li>
  }

  // For leaf nodes, extract text carefully to avoid getting parent text
  // We only want to extract text from the leaf node itself
  const textContent = extractText(children)

  return (
    <li
      {...props}
      className={
        embeddingsEnabled
          ? "cursor-pointer hover:bg-blue-500/10 hover:text-blue-600 dark:hover:text-blue-400 transition-colors rounded px-2 py-1 -mx-2"
          : "rounded px-2 py-1 -mx-2"
      }
      onClick={(e) => {
        if (!embeddingsEnabled) return
        e.stopPropagation()
        if (textContent.trim()) {
          // Optionally remove the citation text from the search query for better semantic matching
          const cleanText = textContent
            .replace(/\[([^\]]+?)\s*#(\d+)\]/g, "")
            .trim()
          setSemanticSearchQuery(cleanText || textContent.trim())
          setActiveTab("posts")
        }
      }}
      title={embeddingsEnabled ? "Click to find related posts" : undefined}
    >
      {replaceCitations(children, resolvePost)}
    </li>
  )
}

const markdownComponents = {
  p: CustomMarkdownP,
  li: CustomMarkdownLi,
}

type SummaryViewProps = {}
const TELEGRAM_MESSAGE_LIMIT = 4096

export const SummaryView: React.FC<SummaryViewProps> = () => {
  const {
    summary,
    handleSummarize,
    generateBackgroundSummary,
    regeneratingSummaries,
    completePendingSummary,
  } = useAI()
  const { isOffline } = useApiStatus()
  const [copied, setCopied] = useState(false)
  const botCredentials = useBotCredentials()
  const chatDestinations = useChatDestinations()
  const summariesHistory = useSummariesHistory()
  const loadHistory = useInvalidateSummaries()
  const { startDate, endDate, currentSummaryId, summarizing } = useUI()

  // The prompt panel below needs the full promptText, which the list
  // projection omits (it was ~94% of that payload).
  const { data: currentSummaryDetail } = useSummaryDetailQuery(currentSummaryId)
  const currentPromptText = currentSummaryDetail?.promptText

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

  const handleRerun = async () => {
    if (isOffline) {
      toast.warning("Server offline — summary generation disabled.")
      return
    }
    if (currentSummary) {
      toast.promise(generateBackgroundSummary(currentSummary, false), {
        loading: "Re-analyzing current time window...",
        success: "Analysis re-run successfully.",
        error: "Failed to re-run analysis.",
      })
    } else {
      handleSummarize()
    }
  }
  const displayDate = currentSummary
    ? new Date(currentSummary.timestamp)
    : new Date()

  const _formatDateTime = (date: Date) => {
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
  }
  const {
    aiLanguage,
    proxyEnabled,
    defaultProxyUrls,
    torEnabled,
    torMode,
    torProxyUrls,
    torAutoRotate,
    torRotationThreshold,
  } = useSettings()

  // Read from the loaded record, so a saved report renders in its own language
  // without having to overwrite the user's setting for the next generation.
  const bodyDirection = reportDirection(currentSummary?.language, aiLanguage)

  const [selectedBotId, setSelectedBotId] = useState<string>("")
  const [selectedDestId, setSelectedDestId] = useState<string>("")
  const [isEditingNote, setIsEditingNote] = useState(false)
  const [noteValue, setNoteValue] = useState("")
  const [sendMetadata, setSendMetadata] = useState(true)
  const [metadataText, setMetadataText] = useState("")
  const [isEditingMetadata, setIsEditingMetadata] = useState(false)
  const [isSavingMetadata, setIsSavingMetadata] = useState(false)
  const telegramBodyLength = summaryBody?.length ?? 0
  const telegramMetadataLength = sendMetadata ? metadataText.length : 0
  const telegramMessageLength =
    telegramBodyLength + telegramMetadataLength + (sendMetadata ? 2 : 0)
  const exceedsTelegramLimit = telegramMessageLength > TELEGRAM_MESSAGE_LIMIT

  React.useEffect(() => {
    if (currentSummary) {
      setSendMetadata(currentSummary.sendMetadata !== false)
      setMetadataText(
        currentSummary.metadataText ||
          generateDefaultMetadataText(currentSummary),
      )
    }
  }, [
    currentSummary?.sendMetadata,
    currentSummary?.metadataText,
    currentSummary,
  ])

  const handleSaveNote = async () => {
    if (!currentSummary) return
    const updatedSummary = { ...currentSummary, note: noteValue }
    await saveSummary(updatedSummary)
    await loadHistory()
    setIsEditingNote(false)
    toast.success("Note saved.")
  }

  const handleDeleteNote = async () => {
    if (!currentSummary) return
    const updatedSummary = { ...currentSummary, note: undefined }
    await saveSummary(updatedSummary)
    await loadHistory()
    setIsEditingNote(false)
    setNoteValue("")
    toast.success("Note deleted.")
  }

  const getActiveProxies = () =>
    buildActiveProxies({
      proxyEnabled,
      defaultProxyUrls,
      torEnabled,
      torMode,
      torProxyUrls,
    })

  const handlePublish = async (
    botId: string,
    chatId: string,
    botName: string,
    text: string,
    destName: string,
  ) => {
    if (isOffline) {
      toast.warning("Server offline — publish disabled.")
      return
    }
    try {
      const activeProxies = getActiveProxies()
      const result = await publishSummary(
        botId,
        chatId,
        text,
        sendMetadata ? metadataText : undefined,
        activeProxies.length > 0,
        torAutoRotate,
        torRotationThreshold,
      )

      // Log the result
      const log: PublishLog = {
        id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
        summaryId: currentSummaryId || `manual-${Date.now()}`,
        botId: botId,
        botName: botName,
        chatId: chatId,
        chatName: destName,
        status: result.success ? "success" : "failed",
        error: result.error,
        timestamp: Date.now(),
        fullRequest: result.requests,
        fullResponse: result.responses,
        textSent: sendMetadata ? `${metadataText}\n\n${text}` : text,
      }
      await savePublishLog(log)

      if (result.success) {
        toast.success(`Successfully published using ${botName}!`)
      } else {
        toast.error(`Error publishing: ${result.error}`)
      }
    } catch (e: unknown) {
      toast.error(
        `Error publishing: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
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
        {isPending && currentSummary ? (
          <>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 border-b border-app-ink/10 pb-6">
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <h3 className="text-2xl font-bold tracking-tight">
                    Awaiting External Response
                  </h3>
                  <span className="bg-amber-500/15 text-amber-800 dark:text-amber-200 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider">
                    Prompt copied
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="bg-app-muted/50 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider text-app-ink/70 flex items-center gap-1.5">
                    <Clock size={12} />{" "}
                    <RelativeTime timestamp={currentSummary.timestamp} />
                  </span>
                  <span className="bg-app-muted/50 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider text-app-ink/70 flex items-center gap-1.5">
                    <Database size={12} />{" "}
                    {formatSummaryModelLabel(currentSummary.model)}
                  </span>
                  <span className="bg-app-muted/50 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider text-app-ink/70 flex items-center gap-1.5">
                    <Tag size={12} /> {currentSummary.language}
                  </span>
                </div>
              </div>
              <TgButton
                type="button"
                variant="primary"
                size="lg"
                onClick={() => setPasteModalOpen(true)}
                className="h-11 px-5"
              >
                <ClipboardPaste size={14} />
                Paste AI Response
              </TgButton>
            </div>

            <p className="text-sm text-app-ink/80 mb-4">
              This summary is waiting for your external AI result. Run the
              copied prompt in your AI tool, then paste the response here to
              complete the pending history entry.
            </p>

            <div className="rounded-xl border border-app-ink/10 bg-app-muted/10 p-4 md:p-6">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-[11px] font-bold uppercase tracking-widest text-app-ink/70">
                  Copied Prompt
                </h4>
                <TgButton
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (currentPromptText) {
                      void navigator.clipboard.writeText(currentPromptText)
                      toast.success("Prompt copied again.")
                    }
                  }}
                  disabled={!currentPromptText}
                >
                  <Copy size={12} />
                  Copy again
                </TgButton>
              </div>
              <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed text-app-ink/80 max-h-[480px] overflow-y-auto custom-scrollbar">
                {currentPromptText ?? "Loading prompt…"}
              </pre>
            </div>

            <div className="mt-8 pt-6 border-t border-app-ink/10 flex flex-wrap gap-2">
              <span className="bg-app-muted/30 px-2 py-1 rounded-md text-[11px] font-mono uppercase tracking-widest text-app-ink/70">
                {currentSummary.postCount ?? 0} Posts
              </span>
              <span className="bg-app-muted/30 px-2 py-1 rounded-md text-[11px] font-mono uppercase tracking-widest text-app-ink/70">
                {currentSummary.channels.length} Channels
              </span>
              <span className="bg-app-muted/30 px-2 py-1 rounded-md text-[11px] font-mono uppercase tracking-widest text-app-ink/70">
                Range: {new Date(currentSummary.startDate).toLocaleString()} -{" "}
                {new Date(currentSummary.endDate).toLocaleString()}
              </span>
            </div>
          </>
        ) : summaryBody ? (
          <>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10 border-b border-app-ink/10 pb-6">
              <div>
                <h3 className="text-2xl font-bold tracking-tight mb-3">
                  Analysis Report
                </h3>
                <div className="flex flex-wrap gap-2">
                  <span className="bg-app-muted/50 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider text-app-ink/70 flex items-center gap-1.5">
                    <Clock size={12} />{" "}
                    <RelativeTime timestamp={displayDate.getTime()} />
                  </span>
                  <span className="bg-app-muted/50 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider text-app-ink/70 flex items-center gap-1.5">
                    <Database size={12} />{" "}
                    {formatSummaryModelLabel(currentSummary?.model)}
                  </span>
                  <span className="bg-app-muted/50 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider text-app-ink/70 flex items-center gap-1.5">
                    <Tag size={12} /> {currentSummary?.language}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 bg-app-muted/20 p-1.5 rounded-xl border border-app-ink/5">
                {botCredentials.length > 0 && chatDestinations.length > 0 && (
                  <div className="flex items-center gap-2 mr-4">
                    <select
                      value={selectedBotId}
                      onChange={(e) => setSelectedBotId(e.target.value)}
                      className="bg-transparent border border-app-ink border-opacity-20 rounded-lg py-1.5 px-2 focus:outline-none focus:border-opacity-100 transition-colors text-[11px] font-mono appearance-none cursor-pointer"
                    >
                      <option value="">Bot</option>
                      {botCredentials.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={selectedDestId}
                      onChange={(e) => setSelectedDestId(e.target.value)}
                      className="bg-transparent border border-app-ink border-opacity-20 rounded-lg py-1.5 px-2 focus:outline-none focus:border-opacity-100 transition-colors text-[11px] font-mono appearance-none cursor-pointer"
                    >
                      <option value="">Dest</option>
                      {chatDestinations.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <TgButton
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const bot = botCredentials.find(
                              (b) => b.id === selectedBotId,
                            )
                            const dest = chatDestinations.find(
                              (d) => d.id === selectedDestId,
                            )
                            if (bot && dest && summary)
                              handlePublish(
                                bot.id,
                                dest.chatId,
                                bot.name,
                                summary,
                                dest.name,
                              )
                            else
                              toast.error(
                                "Please select both Bot and Destination.",
                              )
                          }}
                          disabled={!selectedBotId || !selectedDestId}
                        >
                          <Send size={12} />
                          Publish
                        </TgButton>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>
                          Sends the summary to the selected Telegram
                          destination.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                )}
                {currentSummary && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <TgButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (isEditingNote) {
                            setIsEditingNote(false)
                          } else {
                            setIsEditingNote(true)
                            setNoteValue(currentSummary.note || "")
                          }
                        }}
                        className={
                          currentSummary.note
                            ? "text-amber-600 bg-amber-500/10"
                            : undefined
                        }
                      >
                        <StickyNote
                          size={12}
                          className={isEditingNote ? "fill-current" : ""}
                        />
                        Note
                      </TgButton>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>
                        {isEditingNote
                          ? "Close Note"
                          : currentSummary.note
                            ? "Edit Note"
                            : "Add Note"}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TgButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleRerun}
                      loading={summarizing || isRegenerating}
                      loadingLabel="Re-analyze Window"
                    >
                      <RefreshCw size={12} />
                      Re-analyze Window
                    </TgButton>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Re-analyzes the current time window.</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TgButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(summaryBody ?? "")
                        setCopied(true)
                        setTimeout(() => setCopied(false), 2000)
                      }}
                    >
                      {copied ? <Check size={12} /> : <Copy size={12} />}
                      {copied ? "Copied" : "Copy Text"}
                    </TgButton>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Copies the summary text to your clipboard.</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TgButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const blob = new Blob([summaryBody ?? ""], {
                          type: "text/markdown",
                        })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement("a")
                        a.href = url
                        a.download = `analysis-${formatDateToLocalISO(new Date()).split("T")[0]}.md`
                        a.click()
                        URL.revokeObjectURL(url)
                      }}
                    >
                      <Download size={12} />
                      Export .MD
                    </TgButton>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Downloads the summary as a Markdown file.</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-mono">
                <span
                  className={`rounded-md px-2 py-1 ${exceedsTelegramLimit ? "bg-red-500/10 text-red-600" : "bg-app-muted/40 text-app-ink/60"}`}
                >
                  Telegram chars: {telegramMessageLength}/
                  {TELEGRAM_MESSAGE_LIMIT}
                </span>
                {exceedsTelegramLimit && (
                  <span className="text-red-600/90">
                    Message may exceed Telegram single-message limit.
                  </span>
                )}
              </div>
            </div>
            <div
              dir={bodyDirection.dir}
              className={`prose prose-sm md:prose-base max-w-none prose-headings:tracking-tight prose-headings:font-bold prose-p:leading-relaxed prose-p:text-app-ink/80 prose-li:text-app-ink/80 prose-li:my-1 dark:prose-invert ${bodyDirection.className}`}
            >
              <ReactMarkdown components={markdownComponents}>
                {summaryBody}
              </ReactMarkdown>
            </div>

            {currentSummary && (isEditingNote || currentSummary.note) && (
              <div className="mt-8">
                {isEditingNote ? (
                  <motion.div
                    initial={{ opacity: 0, y: -10, rotate: -1 }}
                    animate={{ opacity: 1, y: 0, rotate: 0 }}
                    exit={{ opacity: 0, y: -10, rotate: 1 }}
                    className="p-4 bg-gradient-to-br from-[#fef08a] to-[#fde047] rounded-sm shadow-[2px_4px_12px_rgba(0,0,0,0.08)] relative overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Fold effect top right */}
                    <div className="absolute top-0 right-0 w-6 h-6 bg-gradient-to-bl from-transparent via-transparent to-[rgba(0,0,0,0.05)] rounded-bl-lg" />

                    <textarea
                      value={noteValue}
                      onChange={(e) => setNoteValue(e.target.value)}
                      onInput={(e) => {
                        const target = e.target as HTMLTextAreaElement
                        target.style.height = "auto"
                        target.style.height = `${target.scrollHeight}px`
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          handleSaveNote()
                        } else if (e.key === "Escape") {
                          setIsEditingNote(false)
                        }
                      }}
                      placeholder="Jot down your thoughts... (Cmd+Enter to save)"
                      className="w-full bg-transparent border-none text-[13px] font-medium text-amber-950 placeholder:text-amber-900/40 focus:outline-none resize-none min-h-[80px] leading-relaxed"
                    />
                    <div className="flex justify-between items-center mt-3 pt-2 border-t border-amber-500/20">
                      <span className="text-[11px] text-amber-700/80 font-medium">
                        {noteValue.length} chars
                      </span>
                      <div className="flex gap-2 items-center">
                        {currentSummary.note && (
                          <TgButton
                            type="button"
                            variant="dangerSoft"
                            size="sm"
                            onClick={handleDeleteNote}
                            className="mr-1 border-0 bg-transparent hover:bg-red-500/10"
                          >
                            Delete
                          </TgButton>
                        )}
                        <TgButton
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setIsEditingNote(false)}
                          className="text-amber-800/80 hover:text-amber-900 hover:bg-amber-500/10"
                        >
                          Cancel
                        </TgButton>
                        <TgButton
                          type="button"
                          variant="primary"
                          size="sm"
                          onClick={handleSaveNote}
                          className="bg-amber-900 hover:bg-amber-950 hover:opacity-100 text-amber-50 shadow-sm"
                        >
                          Save Note
                        </TgButton>
                      </div>
                    </div>
                  </motion.div>
                ) : currentSummary.note ? (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 bg-gradient-to-br from-[#fef08a]/90 to-[#fde047]/90 rounded-sm shadow-sm cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all relative overflow-hidden group"
                    onClick={() => {
                      setIsEditingNote(true)
                      setNoteValue(currentSummary.note || "")
                    }}
                  >
                    {/* Fold effect top right */}
                    <div className="absolute top-0 right-0 w-6 h-6 bg-gradient-to-bl from-transparent via-transparent to-[rgba(0,0,0,0.05)] rounded-bl-lg transition-all group-hover:w-8 group-hover:h-8" />

                    <div className="flex justify-between items-start mb-2">
                      <span className="font-bold uppercase text-[11px] tracking-wider text-amber-800/80 flex items-center gap-1.5">
                        <StickyNote size={12} className="text-amber-700/50" />
                        Note
                      </span>
                      <span className="opacity-0 group-hover:opacity-100 text-[11px] font-medium text-amber-700/80 transition-opacity bg-amber-500/10 px-2 py-0.5 rounded-full">
                        Edit
                      </span>
                    </div>
                    <p className="text-[13px] font-medium text-amber-950 whitespace-pre-wrap leading-relaxed">
                      {currentSummary.note}
                    </p>
                  </motion.div>
                ) : null}
              </div>
            )}

            {currentSummary && (
              <div className="mt-8 border-t border-app-ink/10 pt-6">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-[11px] font-bold uppercase tracking-widest text-app-ink/70">
                    Publish Metadata
                  </h4>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sendMetadata}
                      onChange={async (e) => {
                        const checked = e.target.checked
                        setSendMetadata(checked)
                        const updatedSummary = {
                          ...currentSummary,
                          sendMetadata: checked,
                        }
                        await saveSummary(updatedSummary)
                        await loadHistory()
                      }}
                      className="w-3 h-3 accent-app-ink"
                    />
                    <span className="text-[11px] uppercase font-bold text-app-ink">
                      Include Metadata
                    </span>
                  </label>
                </div>

                {sendMetadata && (
                  <div className="bg-app-muted/5 border border-app-ink/10 rounded-lg p-4">
                    {isEditingMetadata ? (
                      <div className="space-y-3">
                        <textarea
                          value={metadataText}
                          onChange={(e) => setMetadataText(e.target.value)}
                          className="w-full bg-transparent border border-app-ink/20 rounded p-3 text-xs font-mono focus:outline-none focus:border-app-ink/50 min-h-[120px]"
                        />
                        <div className="flex justify-end gap-2">
                          <TgButton
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setMetadataText(
                                currentSummary.metadataText ||
                                  generateDefaultMetadataText(currentSummary),
                              )
                              setIsEditingMetadata(false)
                            }}
                          >
                            Cancel
                          </TgButton>
                          <TgButton
                            type="button"
                            variant="primary"
                            size="sm"
                            loading={isSavingMetadata}
                            loadingLabel="Saving…"
                            onClick={async () => {
                              if (!currentSummary) return
                              setIsSavingMetadata(true)
                              try {
                                const updatedSummary = {
                                  ...currentSummary,
                                  metadataText,
                                }
                                await saveSummary(updatedSummary)
                                await loadHistory()
                                setIsEditingMetadata(false)
                                toast.success("Metadata updated.")
                              } finally {
                                setIsSavingMetadata(false)
                              }
                            }}
                          >
                            Save
                          </TgButton>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="group relative cursor-pointer"
                        onClick={() => setIsEditingMetadata(true)}
                      >
                        <pre className="text-xs font-mono whitespace-pre-wrap opacity-80 group-hover:opacity-100 transition-opacity">
                          {metadataText}
                        </pre>
                        <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity bg-app-bg/80 backdrop-blur-sm px-2 py-1 rounded text-[11px] font-bold uppercase border border-app-ink/10">
                          Click to Edit
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {currentSummary && (
              <div className="mt-12 pt-6 border-t border-app-ink/10 flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="bg-app-muted/30 px-2 py-1 rounded-md text-[11px] font-mono uppercase tracking-widest text-app-ink/70">
                    {currentSummary.postCount} Posts Analyzed
                  </span>
                  <span className="bg-app-muted/30 px-2 py-1 rounded-md text-[11px] font-mono uppercase tracking-widest text-app-ink/70">
                    {currentSummary.channels.length} Channels
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="bg-app-muted/30 px-2 py-1 rounded-md text-[11px] font-mono uppercase tracking-widest text-app-ink/70">
                    Range: {new Date(startDate).toLocaleString()} -{" "}
                    {new Date(endDate).toLocaleString()}
                  </span>
                </div>
              </div>
            )}
          </>
        ) : summarizing ? (
          <div className="h-full flex flex-col py-12 space-y-8 animate-pulse">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 bg-app-muted/20 rounded-xl" />
              <div className="space-y-2">
                <div className="h-5 bg-app-muted/20 rounded-md w-48" />
                <div className="h-3 bg-app-muted/20 rounded-md w-32" />
              </div>
            </div>
            <div className="space-y-4">
              <div className="h-4 bg-app-muted/20 rounded-md w-full" />
              <div className="h-4 bg-app-muted/20 rounded-md w-full" />
              <div className="h-4 bg-app-muted/20 rounded-md w-5/6" />
            </div>
            <div className="space-y-4 pt-4">
              <div className="h-4 bg-app-muted/20 rounded-md w-full" />
              <div className="h-4 bg-app-muted/20 rounded-md w-4/5" />
            </div>
            <div className="flex justify-center pt-8">
              <div className="flex items-center gap-2 text-app-ink/60">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-xs font-bold uppercase tracking-widest">
                  Generating Analysis...
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center py-32">
            <div className="w-20 h-20 rounded-3xl bg-app-muted/20 flex items-center justify-center mb-6">
              <FileText size={40} className="opacity-20" strokeWidth={1.5} />
            </div>
            <h3 className="text-lg font-bold tracking-tight mb-2">
              Ready to Summarize
            </h3>
            <p className="text-xs text-app-ink/70 max-w-[280px] mx-auto leading-relaxed">
              Generate in-app, or use Copy Prompt to run an external AI and
              paste the response from History.
            </p>
          </div>
        )}
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
