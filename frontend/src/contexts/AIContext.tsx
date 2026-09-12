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
import {
  deleteSummary,
  saveSummary,
  submitSummary,
} from "@/lib/summaries/store"
import {
  formatSummaryModelLabel,
  isPendingSummary,
  resolvePastedSummaryModel,
} from "../constants"
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
import type { LLMLog, Post, PublishLog, Summary } from "../types"
import { useChatContext } from "./ChatContext"
import { useData } from "./DataContext"
import { useScope } from "./ScopeContext"
import { useScraper } from "./ScraperContext"
import { useSettings } from "./SettingsContext"
import { useUI } from "./UIContext"

const extractCitedPosts = (
  text: string,
  availablePosts: Post[],
): Record<string, Post> => {
  const cited: Record<string, Post> = {}
  const regex = /\[([^\]]+?)\s*#(\d+)\]/g
  let match
  while ((match = regex.exec(text)) !== null) {
    const channelName = match[1].trim()
    const postId = parseInt(match[2], 10)
    const key = `${channelName}-${postId}`
    if (!cited[key]) {
      const post = availablePosts.find(
        (p) => p.channelName === channelName && p.id === postId,
      )
      if (post) {
        cited[key] = post
      }
    }
  }
  return cited
}

/**
 * Extract the distinct `[channelName #id]` citation references from a summary
 * body, so only the cited posts need to be looked up (rather than refetching a
 * channel's whole history). Mirrors the pattern `extractCitedPosts` matches.
 */
const parseCitationRefs = (
  text: string,
): { channelName: string; postId: number }[] => {
  const refs: { channelName: string; postId: number }[] = []
  const seen = new Set<string>()
  const regex = /\[([^\]]+?)\s*#(\d+)\]/g
  let match
  while ((match = regex.exec(text)) !== null) {
    const channelName = match[1].trim()
    const postId = parseInt(match[2], 10)
    const key = `${channelName}-${postId}`
    if (!seen.has(key)) {
      seen.add(key)
      refs.push({ channelName, postId })
    }
  }
  return refs
}

export const generateDefaultMetadataText = (s: Summary): string => {
  return `📊 *Analysis Metadata*\n🕒 *Time Range:* ${new Date(s.startDate).toLocaleString()} - ${new Date(s.endDate).toLocaleString()}\n📡 *Channels Used:* ${s.channels?.length || 0}\n📋 *Channel List:* ${(s.channels || []).map((c) => `@${c}`).join(", ")}\n🤖 *AI Model:* ${formatSummaryModelLabel(s.model)}\n📝 *Posts Analyzed:* ${s.postCount || 0}`
}

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
    try {
      let newStartDate = s.startDate
      let newEndDate = s.endDate

      if (shiftTime) {
        const durationMs = s.endDate - s.startDate
        newStartDate = s.endDate
        newEndDate = s.endDate + durationMs
      }

      const newEndDateTimestamp = newEndDate

      // Sync channels first - only if they haven't been updated since the new summary's end date
      const channelsToSync = channels.filter((c) => {
        if (!s.channels.includes(c.name)) return false
        const lastUpdated = c.lastUpdated || 0
        return lastUpdated < newEndDateTimestamp
      })

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
      const scope: PromptScope = {
        startDate: newStartDate,
        endDate: newEndDate,
      }
      // AW-02: the shifted window starts where the last Summary ended and runs
      // into the future, and `fixedWindow` holds its end to the server's
      // current minute. Inside the same minute that leaves start === end, which
      // the server refuses — so a regeneration that simply came round too soon
      // would fail instead of writing the "no new posts" note it always has.
      // Asking is what is skipped here, not the answer: the answer is zero.
      const noTimeHasPassed = floorToMinute(newStartDate) >= serverMinuteStart()
      const counts = noTimeHasPassed
        ? {}
        : await api.getPostsCounts({
            channelNames: s.channels,
            ...scope,
          })
      const postCount = Object.values(counts).reduce((sum, n) => sum + n, 0)

      let fullSummaryText = ""
      if (postCount === 0) {
        fullSummaryText = `No new posts found in the selected channels between ${new Date(newStartDate).toLocaleString()} and ${new Date(newEndDate).toLocaleString()}.`
      } else {
        const startTime = Date.now()
        const result = await generateSummary(
          s.channels,
          formatChannelsForPrompt(channels, s.channels, {
            includeBio: includeChannelBioInPrompt,
            includeTags: includeChannelTagsInPrompt,
          }),
          "",
          s.language,
          s.model || "gemini-3-flash-preview",
          aiTemperature,
          scope,
        )
        fullSummaryText = result.text
        const { prompt, config, fullResponse } = result
        const duration = Date.now() - startTime

        // Log LLM Interaction
        const llmLog: LLMLog = {
          id:
            Date.now().toString() + Math.random().toString(36).substring(2, 7),
          model: s.model || "gemini-3-flash-preview",
          prompt: prompt,
          response: fullSummaryText,
          modelConfig: config,
          fullRequest: { contents: [{ parts: [{ text: prompt }] }], config },
          fullResponse: fullResponse,
          tokens: fullResponse?.usageMetadata?.totalTokenCount,
          status: "success",
          timestamp: Date.now(),
          duration: duration,
          type: "summary",
        }
        await saveLLMLog(llmLog)
      }

      // A UUID for the reason the interactive path uses one.
      const newId = crypto.randomUUID()

      // The scope path never holds the posts, so citations are resolved by
      // lookup — the same two-step the interactive path uses.
      const citedPosts = extractCitedPosts(
        fullSummaryText,
        await lookupPosts(parseCitationRefs(fullSummaryText)),
      )

      const newSummary: Summary = {
        id: newId,
        text: fullSummaryText,
        channels: s.channels,
        startDate: newStartDate,
        endDate: newEndDate,
        language: s.language,
        model: s.model,
        postCount,
        timestamp: Date.now(),
        autoRegenerate: true,
        // **The Key that actually paid, which is the live selection** — not
        // the one the old Summary stored (BYOK-03).
        //
        // Written the other way round first, and it was wrong: this path
        // regenerates through `generateSummary`, whose `withAiKey` sends
        // `selectedAiKeyId()` and never consults `s.aiKeyId`. So a Summary
        // stamped key A, re-run after switching the chooser to B, billed B,
        // logged B's provider — and then wrote A onto the successor, so
        // tonight the scheduler charges A again. One chain, two Keys,
        // depending on which path regenerated it: exactly the ambiguity this
        // ticket set out to close.
        //
        // `s.aiKeyId` remains the fallback for a Summary scheduled before this
        // field existed, where nothing is selected and the server picked.
        aiKeyId: selectedAiKeyId() ?? s.aiKeyId ?? undefined,
        autoPublish: s.autoPublish,
        publishBotId: s.publishBotId,
        publishChatId: s.publishChatId,
        sendMetadata: s.sendMetadata !== undefined ? s.sendMetadata : true,
        postSearch: s.postSearch,
        semanticSearchQuery: s.semanticSearchQuery,
        semanticSearchRespectsChannels: s.semanticSearchRespectsChannels,
        citedPosts,
      }
      await saveSummary(newSummary)

      // Auto-publish if enabled
      if (s.autoPublish && s.publishBotId && s.publishChatId && postCount > 0) {
        const bot = botCredentials.find((b) => b.id === s.publishBotId)
        const dest = chatDestinations.find((d) => d.id === s.publishChatId)
        if (bot && dest) {
          const activeProxies = getActiveProxies()
          const generatedMetadata = generateDefaultMetadataText(newSummary)
          const result = await publishSummary(
            bot.id,
            dest.chatId,
            fullSummaryText,
            newSummary.sendMetadata
              ? newSummary.metadataText || generatedMetadata
              : undefined,
            activeProxies.length > 0,
            torAutoRotate,
            torRotationThreshold,
          )

          // Log the result
          const log: PublishLog = {
            id:
              Date.now().toString() +
              Math.random().toString(36).substring(2, 7),
            summaryId: newId,
            botId: bot.id,
            botName: bot.name,
            chatId: dest.chatId,
            chatName: dest.name,
            status: result.success ? "success" : "failed",
            error: result.error,
            timestamp: Date.now(),
            fullRequest: result.requests,
            fullResponse: result.responses,
            textSent: newSummary.sendMetadata
              ? `${newSummary.metadataText || generatedMetadata}\n\n${fullSummaryText}`
              : fullSummaryText,
          }
          await savePublishLog(log)

          if (result.success) {
            toast.success(`Auto-published summary to ${dest.name}`)
          } else {
            console.error("Auto-publish failed:", result.error)
            toast.error(`Auto-publish failed: ${result.error}`)
          }
        }
      }

      // Update the old summary to not auto-regenerate anymore
      const oldSummary = { ...s, autoRegenerate: false }
      await saveSummary(oldSummary)

      await loadHistory()
    } catch (err: unknown) {
      let errorMessage = err instanceof Error ? err.message : "Unknown error"
      let isQuotaExceeded = false

      try {
        if (errorMessage.startsWith("{") && errorMessage.endsWith("}")) {
          const parsed = JSON.parse(errorMessage)
          if (parsed.error?.message) {
            errorMessage = parsed.error.message
            if (parsed.error.code === 429) {
              isQuotaExceeded = true
            }
          }
        } else if (
          errorMessage.includes("429") ||
          errorMessage.includes("RESOURCE_EXHAUSTED") ||
          errorMessage.toLowerCase().includes("quota") ||
          errorMessage.toLowerCase().includes("rate limit")
        ) {
          isQuotaExceeded = true
        }
      } catch (_e) {
        // Ignore parse errors
      }

      console.error("Failed to generate background summary:", err)
      toast.error(`Failed to generate background summary: ${errorMessage}`)

      if (isQuotaExceeded) {
        // Disable auto-regenerate to prevent spamming the API
        const oldSummary = { ...s, autoRegenerate: false }
        await saveSummary(oldSummary)
        await loadHistory()
      }
    } finally {
      setRegeneratingSummaries((prev) => {
        const next = new Set(prev)
        next.delete(s.id)
        return next
      })
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
