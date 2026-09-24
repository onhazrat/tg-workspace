import type React from "react"
import { createContext, useContext, useState } from "react"
import { toast } from "sonner"
import { api } from "@/api"
import type { PromptScope } from "@/api/data"
import { useBotCredentials, useChatDestinations } from "@/hooks/useBots"
import {
  useInvalidateSummaries,
  useSummariesHistory,
} from "@/hooks/useSummaries"
import { selectedAiKeyId } from "@/lib/aiKeys/selection"
import { serverMinuteStart } from "@/lib/analysis-window"
import {
  errorText,
  frozenScope,
  type PromptPosts,
  type ProvisionalRow,
  promptPosts,
  readStream,
  searchFilterExtra,
  withProvisionalRow,
} from "@/lib/artifacts/artifact-run"
import { staleSelectedChannels } from "@/lib/chat-sessions/chat-turn"
import { saveLLMLog, savePublishLog } from "@/lib/logs/write"
import { lookupPosts } from "@/lib/posts/store"
import { scopeChannels } from "@/lib/scope/artifact-scope"
import {
  deleteSummary,
  saveSummary,
  submitSummary,
} from "@/lib/summaries/store"
import {
  autoPublishTarget,
  channelsNeedingSync,
  classifyAiError,
  noPostsText,
  publishedText,
  successorSummary,
  summaryMetadataText,
} from "@/lib/summaries/summary-model"
import {
  checkPastedSummary,
  countRegeneratedPosts,
  NO_POSTS_MESSAGE,
  pastedSummaryRecord,
  regeneratedRange,
  resolveCitedPosts,
  summaryLLMLog,
} from "@/lib/summaries/summary-run"
import { useApiStatus } from "../hooks/useApiStatus"
import { formatChannelsForPrompt } from "../lib/channels/format-channels-for-prompt"
import { buildActiveProxies } from "../lib/syncSettings"
import {
  generateSummary,
  generateSummaryStream,
  getSummaryPrompt,
} from "../services/ai"
import { publishSummary } from "../services/telegram"
import type { BotCredential, ChatDestination, Summary } from "../types"
import { useChatContext } from "./ChatContext"
import { useData } from "./DataContext"
import { useScope } from "./ScopeContext"
import { useScraper } from "./ScraperContext"
import { useSettings } from "./SettingsContext"
import { useUI } from "./UIContext"

interface AIContextType {
  summary: string | null
  setSummary: React.Dispatch<React.SetStateAction<string | null>>
  regeneratingSummaries: Set<string>
  copied: boolean
  handleSummarize: () => Promise<void>
  copySummaryPrompt: () => Promise<void>
  completePendingSummary: (
    summaryId: string,
    text: string,
    modelName?: string,
  ) => Promise<boolean>
  generateBackgroundSummary: (s: Summary, shiftTime?: boolean) => Promise<void>
  copyToClipboard: () => void
}

const AIContext = createContext<AIContextType | undefined>(undefined)

export const AIProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { channels, selectedChannels } = useData()
  const summariesHistory = useSummariesHistory()
  const loadHistory = useInvalidateSummaries()
  const botCredentials = useBotCredentials()
  const chatDestinations = useChatDestinations()
  // Only `endDate`: what a Summary is *about* is frozen server-side now
  // (AW-05), and the one thing left that needs a boundary here is deciding
  // which channels to sync before generating.
  const { endDate } = useScope()
  const {
    setActiveTab,
    setSummarizing,
    setCurrentSummaryId,
    includeChannelBioInPrompt,
    includeChannelTagsInPrompt,
  } = useUI()
  const {
    aiLanguage,
    selectedModel,
    aiTemperature,
    proxyEnabled,
    defaultProxyUrls,
    torEnabled,
    torMode,
    torProxyUrls,
    torAutoRotate,
    torRotationThreshold,
  } = useSettings()
  const {
    scrapeChannelsInParallel,
    postSearch,
    semanticSearchQuery,
    semanticSearchRespectsChannels,
    handleFilterPosts,
    getPromptPostsInput,
    getScopeSubmission,
  } = useScraper()
  const { setChatMessages } = useChatContext()
  const { isOffline } = useApiStatus()

  const [summary, setSummary] = useState<string | null>(null)
  const [regeneratingSummaries, setRegeneratingSummaries] = useState<
    Set<string>
  >(new Set())
  const [copied, setCopied] = useState(false)

  const getActiveProxies = () =>
    buildActiveProxies({
      proxyEnabled,
      defaultProxyUrls,
      torEnabled,
      torMode,
      torProxyUrls,
    })

  const selectedChannelNames = () =>
    channels
      .filter((channel) => selectedChannels.has(channel.name))
      .map((channel) => channel.name)

  const channelsText = () =>
    formatChannelsForPrompt(channels, selectedChannels, {
      includeBio: includeChannelBioInPrompt,
      includeTags: includeChannelTagsInPrompt,
    })

  /** Sync the selected channels whose posts may not reach the window's end yet. */
  const syncStaleSelection = async () => {
    const stale = staleSelectedChannels(
      channels,
      selectedChannels,
      endDate,
      Date.now(),
    )
    if (stale.length === 0) return
    toast.info(`Syncing ${stale.length} channels to ensure up-to-date data...`)
    await scrapeChannelsInParallel(stale, "Pre-Summary Sync")
    // Refresh the eager Posts-tab list so the UI reflects the sync.
    handleFilterPosts()
  }

  /**
   * Submit before a single token is spent (AW-05). The server resolves the
   * Analysis window against its own current minute and stores the result, so
   * model latency, a retry and this browser's clock cannot move the boundaries
   * the finished Summary claims it used.
   *
   * The caller mints the id as a UUID, not a timestamp: `id` is the whole
   * primary key of `tg_summaries`, so two accounts submitting in the same
   * millisecond would collide.
   */
  const openSummary = async (
    id: string,
    names: string[],
    posts: PromptPosts,
    row: ProvisionalRow,
    extra: { status?: "pending" },
  ) => {
    const opened = await submitSummary({
      id,
      scope: getScopeSubmission(names, posts.posts),
      language: aiLanguage,
      model: selectedModel,
      postCount: posts.postCount,
      extra: {
        sendMetadata: true,
        ...searchFilterExtra({
          postSearch,
          semanticSearchQuery,
          semanticSearchRespectsChannels,
        }),
        ...extra,
      },
    })
    row.opened(id)
    // Select by what was frozen, not by what the clock says now — the
    // Artifact and the prompt have to name the same two instants.
    return frozenScope(posts.scope, opened.scope)
  }

  const handleSummarize = async () => {
    if (isOffline) {
      toast.warning("Server offline — summary generation disabled.")
      return
    }
    await syncStaleSelection()
    const names = selectedChannelNames()
    const posts = await promptPosts(
      await getPromptPostsInput(),
      names,
      api.getPostsCounts,
    )
    if (posts.postCount === 0) {
      toast.error(NO_POSTS_MESSAGE)
      return
    }

    setSummarizing(true)
    setSummary(null)
    setActiveTab("summary")
    try {
      await withProvisionalRow(deleteSummary, (row) =>
        streamSummary(names, posts, row),
      )
    } catch (err: unknown) {
      console.error(err)
      toast.error(
        errorText(err, "An unexpected error occurred during summarization"),
      )
    } finally {
      setSummarizing(false)
    }
  }

  const streamSummary = async (
    names: string[],
    posts: PromptPosts,
    row: ProvisionalRow,
  ) => {
    const newId = crypto.randomUUID()
    const scope = await openSummary(newId, names, posts, row, {})
    const startTime = Date.now()
    const { stream, prompt, config } = await generateSummaryStream(
      names,
      channelsText(),
      posts.postsText,
      aiLanguage,
      selectedModel,
      aiTemperature,
      scope,
    )
    setChatMessages([]) // Clear chat when new summary starts
    const { text, lastChunk } = await readStream(stream, setSummary)
    await saveLLMLog(
      summaryLLMLog({
        id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
        model: selectedModel,
        prompt,
        config,
        text,
        lastChunk,
        now: Date.now(),
        durationMs: Date.now() - startTime,
      }),
    )
    if (!text) return

    // Only what the run produced. The Scope is already on the row and the
    // server refuses to take it again, so sending it back would be a second
    // copy of a fact that is settled.
    await saveSummary({
      id: newId,
      text,
      model: selectedModel,
      postCount: posts.postCount,
      timestamp: Date.now(),
      status: null,
      citedPosts: await resolveCitedPosts(text, posts.posts, lookupPosts),
    } as unknown as Summary)
    row.keep()
    setCurrentSummaryId(newId)
    await loadHistory()
  }

  const copySummaryPrompt = async () => {
    if (isOffline) {
      toast.warning("Server offline — cannot build summary prompt.")
      return
    }
    // Same rollback as `handleSummarize`, and this path needs it more: the
    // prompt is assembled *after* the row exists, and `clipboard.writeText`
    // rejects routinely — denied permission, a non-secure context. Without
    // this, a person who never received a prompt is left with a `pending`
    // Summary they can only clear by deleting.
    try {
      await withProvisionalRow(deleteSummary, copyPrompt)
    } catch (err: unknown) {
      console.error(err)
      toast.error(errorText(err, "Failed to copy summary prompt"))
    }
  }

  const copyPrompt = async (row: ProvisionalRow) => {
    const names = selectedChannelNames()
    const posts = await promptPosts(
      await getPromptPostsInput(),
      names,
      api.getPostsCounts,
    )
    if (posts.postCount === 0) {
      toast.error(NO_POSTS_MESSAGE)
      return
    }
    // Submit *before* the prompt is assembled, for the same reason the
    // interactive path submits before streaming: the prompt has to be built
    // from the window the Artifact records, and a response pasted back hours
    // later must not be able to reinterpret it. This path genuinely is
    // awaiting a response from somewhere else, which is what `pending` has
    // always meant.
    const newId = crypto.randomUUID()
    const scope = await openSummary(newId, names, posts, row, {
      status: "pending",
    })
    const prompt = await getSummaryPrompt(
      names,
      channelsText(),
      posts.postsText,
      aiLanguage,
      selectedModel,
      aiTemperature,
      scope,
    )
    await navigator.clipboard.writeText(prompt)
    await saveSummary({ id: newId, promptText: prompt } as Summary)
    row.keep()
    setCurrentSummaryId(newId)
    setSummary(null)
    setChatMessages([])
    await loadHistory()
    setActiveTab("summary")
    toast.success("Prompt copied. Paste the AI response when ready.")
  }

  const completePendingSummary = async (
    summaryId: string,
    text: string,
    modelName?: string,
  ): Promise<boolean> => {
    const pasted = checkPastedSummary(
      summariesHistory.find((s) => s.id === summaryId),
      text,
    )
    if (!pasted.ok) {
      toast.error(pasted.error)
      return false
    }
    try {
      const citedPosts = await resolveCitedPosts(
        pasted.text,
        undefined,
        lookupPosts,
      )
      await saveSummary(
        pastedSummaryRecord(pasted.pending, pasted.text, modelName, citedPosts),
      )
      setCurrentSummaryId(summaryId)
      setSummary(pasted.text)
      setChatMessages([])
      await loadHistory()
      setActiveTab("summary")
      toast.success("External AI response saved.")
      return true
    } catch (err: unknown) {
      console.error(err)
      toast.error(errorText(err, "Failed to save pasted summary"))
      return false
    }
  }

  const generateBackgroundSummary = async (
    s: Summary,
    shiftTime: boolean = true,
  ) => {
    if (isOffline) return
    setRegeneratingSummaries((prev) => new Set(prev).add(s.id))
    try {
      await withProvisionalRow(deleteSummary, (row) =>
        regenerate(s, shiftTime, row),
      )
    } catch (err: unknown) {
      await reportRegenerationFailure(s, err)
    } finally {
      setRegeneratingSummaries((prev) => {
        const next = new Set(prev)
        next.delete(s.id)
        return next
      })
    }
  }

  const regenerate = async (
    s: Summary,
    shiftTime: boolean,
    row: ProvisionalRow,
  ) => {
    // **The server derives the successor window** (AW-06). This used to be
    // three lines here and three identical lines in
    // `jobs/auto_summary.py::_regenerate_one`, and the copies had drifted in
    // a way nothing could catch: a successor runs a full Duration past where
    // its predecessor closed, so its end is in the future, and
    // `POST /data/summaries` refuses a stated window that ends in the future
    // — rightly, for a window somebody is choosing right now. So this path
    // fell back to `PUT`, which by AW-05's design writes no Scope at all, and
    // the same chain recorded a complete Scope on the ticks the worker ran
    // and nothing on the ticks a tab was open.
    //
    // Naming the predecessor instead sidesteps that entirely: no caller
    // states the window, so the refusal never applies, and the arithmetic has
    // one home.
    //
    // A UUID for the reason the interactive path uses one.
    const newId = crypto.randomUUID()
    //
    // A re-run (`shiftTime: false`) derives too, and that is not a detail.
    // Stating its window instead was the first cut and it was wrong: every
    // Summary the successor chain produces has an end in the future by
    // design, so the ordinary door refused a re-run of exactly the rows the
    // chain had just written. A window read off an Artifact is derived
    // whichever offset it takes.
    const opened = await submitSummary({
      id: newId,
      derivedFrom: {
        summaryId: s.id,
        mode: shiftTime ? "successor" : "repeat",
      },
    })
    row.opened(newId)
    const range = regeneratedRange(opened)
    const summaryChannels = scopeChannels(opened)

    await syncSummaryChannels(summaryChannels, range.end, s.id)

    // Auto-regenerate always takes the server-assembly path (A1b): it applies
    // no filters beyond the channels and the shifted window, so the scope is
    // fully expressible and there is no semantic branch to fall back to.
    //
    // Note it deliberately ignores the saved `postSearch` /
    // `semanticSearchQuery` — those are carried onto the new summary as
    // metadata but have never been *applied* when regenerating. That
    // asymmetry predates this change and is preserved, not fixed.
    const postCount = await countRegeneratedPosts(
      summaryChannels,
      range,
      serverMinuteStart(),
      api.getPostsCounts,
    )
    const text =
      postCount === 0
        ? noPostsText(range.start, range.end)
        : await generateAndLog(s, summaryChannels, {
            startDate: range.start,
            endDate: range.end,
          })

    // **The Key that actually paid is the live selection** — not the one the
    // old Summary stored (BYOK-03).
    //
    // Written the other way round first, and it was wrong: this path
    // regenerates through `generateSummary`, whose `withAiKey` sends
    // `selectedAiKeyId()` and never consults `s.aiKeyId`. So a Summary
    // stamped key A, re-run after switching the chooser to B, billed B,
    // logged B's provider — and then wrote A onto the successor, so tonight
    // the scheduler charges A again. One chain, two Keys, depending on which
    // path regenerated it: exactly the ambiguity this ticket set out to close.
    const newSummary = successorSummary(s, {
      id: newId,
      text,
      postCount,
      // The scope path never holds the posts, so citations are resolved by
      // lookup — the same two-step the interactive path uses.
      citedPosts: await resolveCitedPosts(text, undefined, lookupPosts),
      selectedAiKeyId: selectedAiKeyId(),
      now: Date.now(),
    })
    await saveSummary(newSummary)
    row.keep()

    const target = autoPublishTarget(
      s,
      postCount,
      botCredentials,
      chatDestinations,
    )
    if (target) await autoPublish(newSummary, target.bot, target.dest)

    // Update the old summary to not auto-regenerate anymore
    await saveSummary({ ...s, autoRegenerate: false })
    await loadHistory()
  }

  /** Sync first, but only channels not already synced past the new end. */
  const syncSummaryChannels = async (
    summaryChannels: string[],
    end: number,
    summaryId: string,
  ) => {
    const stale = channelsNeedingSync(channels, summaryChannels, end)
    if (stale.length === 0) return
    await scrapeChannelsInParallel(
      stale,
      `Auto-Regenerate Summary (${summaryId})`,
    )
  }

  const reportRegenerationFailure = async (s: Summary, err: unknown) => {
    const { message, quotaExceeded } = classifyAiError(err)
    console.error("Failed to generate background summary:", err)
    toast.error(`Failed to generate background summary: ${message}`)
    if (!quotaExceeded) return
    // Disable auto-regenerate to prevent spamming the API
    await saveSummary({ ...s, autoRegenerate: false })
    await loadHistory()
  }

  /** Run the model over `scope` and file the LLM log; returns the text. */
  const generateAndLog = async (
    s: Summary,
    summaryChannels: string[],
    scope: PromptScope,
  ) => {
    const model = s.model || "gemini-3-flash-preview"
    const startTime = Date.now()
    const { text, prompt, config, fullResponse } = await generateSummary(
      summaryChannels,
      formatChannelsForPrompt(channels, summaryChannels, {
        includeBio: includeChannelBioInPrompt,
        includeTags: includeChannelTagsInPrompt,
      }),
      "",
      s.language,
      model,
      aiTemperature,
      scope,
    )
    await saveLLMLog({
      id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
      model,
      prompt,
      response: text,
      modelConfig: config,
      fullRequest: { contents: [{ parts: [{ text: prompt }] }], config },
      fullResponse,
      tokens: fullResponse?.usageMetadata?.totalTokenCount,
      status: "success",
      timestamp: Date.now(),
      duration: Date.now() - startTime,
      type: "summary",
    })
    return text
  }

  const autoPublish = async (
    newSummary: Summary,
    bot: BotCredential,
    dest: ChatDestination,
  ) => {
    const metadata = newSummary.sendMetadata
      ? summaryMetadataText(newSummary)
      : null
    const result = await publishSummary(
      bot.id,
      dest.chatId,
      newSummary.text,
      metadata ?? undefined,
      getActiveProxies().length > 0,
      torAutoRotate,
      torRotationThreshold,
    )
    await savePublishLog({
      id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
      summaryId: newSummary.id,
      botId: bot.id,
      botName: bot.name,
      chatId: dest.chatId,
      chatName: dest.name,
      status: result.success ? "success" : "failed",
      error: result.error,
      timestamp: Date.now(),
      fullRequest: result.requests,
      fullResponse: result.responses,
      textSent: publishedText(metadata, newSummary.text),
    })
    if (result.success) {
      toast.success(`Auto-published summary to ${dest.name}`)
    } else {
      console.error("Auto-publish failed:", result.error)
      toast.error(`Auto-publish failed: ${result.error}`)
    }
  }

  const copyToClipboard = () => {
    if (summary) {
      navigator.clipboard.writeText(summary)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <AIContext.Provider
      value={{
        summary,
        setSummary,
        regeneratingSummaries,
        copied,
        handleSummarize,
        copySummaryPrompt,
        completePendingSummary,
        generateBackgroundSummary,
        copyToClipboard,
      }}
    >
      {children}
    </AIContext.Provider>
  )
}

export function useAI() {
  const context = useContext(AIContext)
  if (context === undefined) {
    throw new Error("useAI must be used within an AIProvider")
  }
  return context
}
