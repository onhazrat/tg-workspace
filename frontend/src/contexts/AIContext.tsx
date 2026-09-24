import type React from "react"
import { createContext, useContext, useState } from "react"
import { toast } from "sonner"
import { api } from "@/api"
import { frozenWindow, type PromptScope } from "@/api/data"
import { useBotCredentials, useChatDestinations } from "@/hooks/useBots"
import {
  useInvalidateSummaries,
  useSummariesHistory,
} from "@/hooks/useSummaries"
import { selectedAiKeyId } from "@/lib/aiKeys/selection"
import { floorToMinute, serverMinuteStart } from "@/lib/analysis-window"
import { saveLLMLog, savePublishLog } from "@/lib/logs/write"
import { lookupPosts } from "@/lib/posts/store"
import { scopeChannels, scopeRange } from "@/lib/scope/artifact-scope"
import {
  deleteSummary,
  saveSummary,
  submitSummary,
} from "@/lib/summaries/store"
import {
  autoPublishTarget,
  channelsNeedingSync,
  classifyAiError,
  extractCitedPosts,
  noPostsText,
  parseCitationRefs,
  publishedText,
  successorSummary,
  summaryMetadataText,
} from "@/lib/summaries/summary-model"
import { isPendingSummary, resolvePastedSummaryModel } from "../constants"
import { useApiStatus } from "../hooks/useApiStatus"
import { formatChannelsForPrompt } from "../lib/channels/format-channels-for-prompt"
import { formatPostsForPrompt } from "../lib/posts/post-view"
import { buildActiveProxies } from "../lib/syncSettings"
import {
  AIServiceError,
  generateSummary,
  generateSummaryStream,
  getSummaryPrompt,
} from "../services/ai"
import { publishSummary } from "../services/telegram"
import type {
  BotCredential,
  ChatDestination,
  LLMLog,
  Post,
  Summary,
} from "../types"
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

  const handleSummarize = async () => {
    if (isOffline) {
      toast.warning("Server offline — summary generation disabled.")
      return
    }
    const now = Date.now()
    const targetTs = Math.min(endDate, now)

    const channelsToSync = channels.filter(
      (c) =>
        selectedChannels.has(c.name) &&
        (!c.lastUpdated || c.lastUpdated < targetTs - 60000), // 1 minute buffer
    )

    if (channelsToSync.length > 0) {
      toast.info(
        `Syncing ${channelsToSync.length} channels to ensure up-to-date data...`,
      )
      await scrapeChannelsInParallel(channelsToSync, "Pre-Summary Sync")

      // Refresh the eager Posts-tab list so the UI reflects the sync.
      handleFilterPosts()
    }

    const selectedChannelNames = channels
      .filter((channel) => selectedChannels.has(channel.name))
      .map((channel) => channel.name)

    // Server-eligible → send the scope (the backend assembles the posts block,
    // no posts cross the wire); semantic/related → client-built postsText. Get
    // the post count + emptiness accordingly; the scope path looks citations up
    // after streaming, since it never holds the posts locally.
    const input = await getPromptPostsInput()
    let postsText = ""
    let scope: PromptScope | undefined
    let postCount: number
    let citationPool: Post[] = []
    if (input.scope) {
      scope = input.scope
      const counts = await api.getPostsCounts({
        channelNames: selectedChannelNames,
        ...input.scope,
      })
      postCount = Object.values(counts).reduce((sum, n) => sum + n, 0)
    } else {
      citationPool = input.posts
      postsText = formatPostsForPrompt(input.posts)
      postCount = input.posts.length
    }

    if (postCount === 0) {
      toast.error(
        "No posts found in the selected date range. Try scraping first.",
      )
      return
    }

    setSummarizing(true)
    setSummary(null)
    setActiveTab("summary")

    // Submission creates the row, so a run that produces nothing has to take
    // it back — otherwise every failed generation litters History with an
    // empty Artifact that has a perfectly good Scope.
    let openedId: string | null = null

    try {
      const channelsText = formatChannelsForPrompt(channels, selectedChannels, {
        includeBio: includeChannelBioInPrompt,
        includeTags: includeChannelTagsInPrompt,
      })

      // Submit before a single token is spent (AW-05). The server resolves the
      // Analysis window against its own current minute and stores the result,
      // so model latency, a retry and this browser's clock cannot move the
      // boundaries the finished Summary claims it used.
      //
      // A UUID, not a timestamp: `id` is the whole primary key of
      // `tg_summaries`, so two accounts submitting in the same millisecond
      // would collide.
      const newId = crypto.randomUUID()
      const opened = await submitSummary({
        id: newId,
        scope: getScopeSubmission(selectedChannelNames, input.posts),
        language: aiLanguage,
        model: selectedModel,
        postCount,
        extra: {
          sendMetadata: true,
          postSearch: postSearch || undefined,
          semanticSearchQuery: semanticSearchQuery || undefined,
          semanticSearchRespectsChannels,
        },
      })

      openedId = newId

      // Select by what was frozen, not by what the clock says now — the
      // Artifact and the prompt have to name the same two instants.
      if (scope && opened.scope) {
        scope = { ...scope, window: frozenWindow(opened.scope) }
      }

      const startTime = Date.now()
      const { stream, prompt, config } = await generateSummaryStream(
        selectedChannelNames,
        channelsText,
        postsText,
        aiLanguage,
        selectedModel,
        aiTemperature,
        scope,
      )

      let fullSummaryText = ""
      let lastResponse: {
        usageMetadata?: { totalTokenCount?: number }
      } | null = null
      setChatMessages([]) // Clear chat when new summary starts

      for await (const chunk of stream) {
        const chunkText = chunk.text || ""
        fullSummaryText += chunkText
        setSummary(fullSummaryText)
        lastResponse = chunk as { usageMetadata?: { totalTokenCount?: number } }
      }

      const duration = Date.now() - startTime

      // Log LLM Interaction
      const llmLog: LLMLog = {
        id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
        model: selectedModel,
        prompt: prompt,
        response: fullSummaryText,
        modelConfig: config,
        fullRequest: { contents: [{ parts: [{ text: prompt }] }], config },
        fullResponse: lastResponse,
        tokens: lastResponse?.usageMetadata?.totalTokenCount,
        status: fullSummaryText ? "success" : "failed",
        timestamp: Date.now(),
        duration: duration,
        type: "summary",
      }
      await saveLLMLog(llmLog)

      if (fullSummaryText) {
        // Scope path never held the posts, so resolve the cited ones by lookup.
        const citedPosts = scope
          ? extractCitedPosts(
              fullSummaryText,
              await lookupPosts(parseCitationRefs(fullSummaryText)),
            )
          : extractCitedPosts(fullSummaryText, citationPool)

        // Only what the run produced. The Scope is already on the row and the
        // server refuses to take it again, so sending it back would be a
        // second copy of a fact that is settled.
        await saveSummary({
          id: newId,
          text: fullSummaryText,
          model: selectedModel,
          postCount,
          timestamp: Date.now(),
          status: null,
          citedPosts,
        } as unknown as Summary)
        openedId = null
        setCurrentSummaryId(newId)
        await loadHistory()
      }
    } catch (err: unknown) {
      console.error(err)
      if (err instanceof AIServiceError) {
        toast.error(err.message)
      } else if (err instanceof Error) {
        toast.error(err.message)
      } else {
        toast.error("An unexpected error occurred during summarization")
      }
    } finally {
      if (openedId) await deleteSummary(openedId).catch(() => {})
      setSummarizing(false)
    }
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
    let openedId: string | null = null

    try {
      const selectedChannelNames = channels
        .filter((channel) => selectedChannels.has(channel.name))
        .map((c) => c.name)
      const input = await getPromptPostsInput()
      let postsText = ""
      let scope: PromptScope | undefined
      let postCount: number
      if (input.scope) {
        scope = input.scope
        const counts = await api.getPostsCounts({
          channelNames: selectedChannelNames,
          ...input.scope,
        })
        postCount = Object.values(counts).reduce((sum, n) => sum + n, 0)
      } else {
        postsText = formatPostsForPrompt(input.posts)
        postCount = input.posts.length
      }
      if (postCount === 0) {
        toast.error(
          "No posts found in the selected date range. Try scraping first.",
        )
        return
      }

      // Submit *before* the prompt is assembled, for the same reason the
      // interactive path submits before streaming: the prompt has to be built
      // from the window the Artifact records, and a response pasted back hours
      // later must not be able to reinterpret it.
      //
      // A UUID for the reason the interactive path uses one.
      const newId = crypto.randomUUID()
      const opened = await submitSummary({
        id: newId,
        scope: getScopeSubmission(selectedChannelNames, input.posts),
        language: aiLanguage,
        model: selectedModel,
        postCount,
        extra: {
          sendMetadata: true,
          postSearch: postSearch || undefined,
          semanticSearchQuery: semanticSearchQuery || undefined,
          semanticSearchRespectsChannels,
          // This path genuinely is awaiting a response from somewhere else,
          // which is what `pending` has always meant.
          status: "pending",
        },
      })
      openedId = newId
      if (scope && opened.scope) {
        scope = { ...scope, window: frozenWindow(opened.scope) }
      }

      const prompt = await getSummaryPrompt(
        selectedChannelNames,
        formatChannelsForPrompt(channels, selectedChannels, {
          includeBio: includeChannelBioInPrompt,
          includeTags: includeChannelTagsInPrompt,
        }),
        postsText,
        aiLanguage,
        selectedModel,
        aiTemperature,
        scope,
      )
      await navigator.clipboard.writeText(prompt)
      await saveSummary({ id: newId, promptText: prompt } as Summary)
      openedId = null
      setCurrentSummaryId(newId)
      setSummary(null)
      setChatMessages([])
      await loadHistory()
      setActiveTab("summary")
      toast.success("Prompt copied. Paste the AI response when ready.")
    } catch (err: unknown) {
      console.error(err)
      if (err instanceof AIServiceError) {
        toast.error(err.message)
      } else if (err instanceof Error) {
        toast.error(err.message)
      } else {
        toast.error("Failed to copy summary prompt")
      }
    } finally {
      if (openedId) await deleteSummary(openedId).catch(() => {})
    }
  }

  const completePendingSummary = async (
    summaryId: string,
    text: string,
    modelName?: string,
  ): Promise<boolean> => {
    const pending = summariesHistory.find((s) => s.id === summaryId)
    if (!pending || !isPendingSummary(pending)) {
      toast.error("This history item is not awaiting an external AI response.")
      return false
    }

    const trimmed = text.trim()
    if (!trimmed) {
      toast.error("Summary text cannot be empty.")
      return false
    }

    try {
      // Only the posts the pasted response actually cites need resolving —
      // look those up by natural key instead of refetching the whole range.
      const citedRefs = parseCitationRefs(trimmed)
      const posts = await lookupPosts(citedRefs)
      const citedPosts = extractCitedPosts(trimmed, posts)

      const completedSummary: Summary = {
        ...pending,
        text: trimmed,
        model: modelName?.trim()
          ? resolvePastedSummaryModel(modelName)
          : pending.model || resolvePastedSummaryModel(),
        source: "pasted",
        citedPosts,
      }
      delete completedSummary.status

      await saveSummary({
        ...completedSummary,
        status: null,
      } as unknown as Summary)
      setCurrentSummaryId(summaryId)
      setSummary(trimmed)
      setChatMessages([])
      await loadHistory()
      setActiveTab("summary")
      toast.success("External AI response saved.")
      return true
    } catch (err: unknown) {
      console.error(err)
      if (err instanceof Error) {
        toast.error(err.message)
      } else {
        toast.error("Failed to save pasted summary")
      }
      return false
    }
  }

  const generateBackgroundSummary = async (
    s: Summary,
    shiftTime: boolean = true,
  ) => {
    if (isOffline) return
    setRegeneratingSummaries((prev) => new Set(prev).add(s.id))
    // Submission creates the row, so a run that produces nothing has to take it
    // back — otherwise every failed regeneration litters History with an empty
    // Artifact that has a perfectly good Scope.
    let openedId: string | null = null
    try {
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
      openedId = newId
      // The server's own answer. There is no local fallback any more: AW-07
      // dropped the trio this used to fall back to, and `submitSummary` with a
      // `derivedFrom` either returns a Scope or refuses, so a missing one here
      // would be a bug to surface rather than a window to guess.
      const range = scopeRange(opened)
      if (!range) {
        throw new Error("The regenerated summary came back with no scope.")
      }
      const summaryChannels = scopeChannels(opened)

      // Sync first, but only channels not already synced past the new end.
      const channelsToSync = channelsNeedingSync(
        channels,
        summaryChannels,
        range.end,
      )
      if (channelsToSync.length > 0) {
        await scrapeChannelsInParallel(
          channelsToSync,
          `Auto-Regenerate Summary (${s.id})`,
        )
      }

      // Auto-regenerate always takes the server-assembly path (A1b): it applies
      // no filters beyond the channels and the shifted window, so the scope is
      // fully expressible and there is no semantic branch to fall back to.
      //
      // Note it deliberately ignores the saved `postSearch` /
      // `semanticSearchQuery` — those are carried onto the new summary as
      // metadata but have never been *applied* when regenerating. That
      // asymmetry predates this change and is preserved, not fixed.
      const scope: PromptScope = { startDate: range.start, endDate: range.end }
      // AW-02: the shifted window starts where the last Summary ended and runs
      // into the future, and `fixedWindow` holds its end to the server's
      // current minute. Inside the same minute that leaves start === end, which
      // the server refuses — so a regeneration that simply came round too soon
      // would fail instead of writing the "no new posts" note it always has.
      // Asking is what is skipped here, not the answer: the answer is zero.
      const noTimeHasPassed = floorToMinute(range.start) >= serverMinuteStart()
      const counts = noTimeHasPassed
        ? {}
        : await api.getPostsCounts({ channelNames: summaryChannels, ...scope })
      const postCount = Object.values(counts).reduce((sum, n) => sum + n, 0)

      const text =
        postCount === 0
          ? noPostsText(range.start, range.end)
          : await generateAndLog(s, summaryChannels, scope)

      // The scope path never holds the posts, so citations are resolved by
      // lookup — the same two-step the interactive path uses.
      const citedPosts = extractCitedPosts(
        text,
        await lookupPosts(parseCitationRefs(text)),
      )

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
        citedPosts,
        selectedAiKeyId: selectedAiKeyId(),
        now: Date.now(),
      })
      await saveSummary(newSummary)
      openedId = null

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
    } catch (err: unknown) {
      const { message, quotaExceeded } = classifyAiError(err)
      console.error("Failed to generate background summary:", err)
      toast.error(`Failed to generate background summary: ${message}`)
      if (quotaExceeded) {
        // Disable auto-regenerate to prevent spamming the API
        await saveSummary({ ...s, autoRegenerate: false })
        await loadHistory()
      }
    } finally {
      if (openedId) await deleteSummary(openedId).catch(() => {})
      setRegeneratingSummaries((prev) => {
        const next = new Set(prev)
        next.delete(s.id)
        return next
      })
    }
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
