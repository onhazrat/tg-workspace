import type React from "react"
import { createContext, useContext, useState } from "react"
import { toast } from "sonner"
import { api } from "@/api"
import type { PromptScope } from "@/api/data"
import { saveLLMLog, savePublishLog } from "@/lib/logs/write"
import { saveSummary } from "@/lib/summaries/store"
import {
  formatSummaryModelLabel,
  isPendingSummary,
  resolvePastedSummaryModel,
} from "../constants"
import { useApiStatus } from "../hooks/useApiStatus"
import { formatChannelsForPrompt } from "../lib/channels/format-channels-for-prompt"
import { formatPostsForPrompt } from "../lib/posts/post-view"
import { lookupPosts } from "../lib/repository"
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
  const {
    channels,
    selectedChannels,
    loadHistory,
    summariesHistory,
    botCredentials,
    chatDestinations,
    loadLLMLogs,
  } = useData()
  const {
    startDate,
    endDate,
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
    semanticSearchRespectsTimeRange,
    semanticSearchRespectsChannels,
    handleFilterPosts,
    getPromptPostsInput,
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

    try {
      const channelsText = formatChannelsForPrompt(channels, selectedChannels, {
        includeBio: includeChannelBioInPrompt,
        includeTags: includeChannelTagsInPrompt,
      })

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
      await loadLLMLogs()

      if (fullSummaryText) {
        const newId = Date.now().toString()

        // Scope path never held the posts, so resolve the cited ones by lookup.
        const citedPosts = scope
          ? extractCitedPosts(
              fullSummaryText,
              await lookupPosts(parseCitationRefs(fullSummaryText)),
            )
          : extractCitedPosts(fullSummaryText, citationPool)

        const newSummary: Summary = {
          id: newId,
          text: fullSummaryText,
          channels: Array.from(selectedChannels),
          startDate,
          endDate,
          language: aiLanguage,
          model: selectedModel,
          postCount,
          timestamp: Date.now(),
          sendMetadata: true,
          postSearch: postSearch || undefined,
          semanticSearchQuery: semanticSearchQuery || undefined,
          semanticSearchRespectsTimeRange,
          semanticSearchRespectsChannels,
          citedPosts,
        }
        await saveSummary(newSummary)
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
      setSummarizing(false)
    }
  }

  const copySummaryPrompt = async () => {
    if (isOffline) {
      toast.warning("Server offline — cannot build summary prompt.")
      return
    }

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

      const newId = Date.now().toString()
      const pendingSummary: Summary = {
        id: newId,
        text: "",
        channels: Array.from(selectedChannels),
        startDate,
        endDate,
        language: aiLanguage,
        model: selectedModel,
        postCount,
        timestamp: Date.now(),
        sendMetadata: true,
        postSearch: postSearch || undefined,
        semanticSearchQuery: semanticSearchQuery || undefined,
        semanticSearchRespectsTimeRange,
        semanticSearchRespectsChannels,
        status: "pending",
        promptText: prompt,
      }

      await saveSummary(pendingSummary)
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
      const counts = await api.getPostsCounts({
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
        await loadLLMLogs()
      }

      const newId = Date.now().toString()

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
        autoPublish: s.autoPublish,
        publishBotId: s.publishBotId,
        publishChatId: s.publishChatId,
        sendMetadata: s.sendMetadata !== undefined ? s.sendMetadata : true,
        postSearch: s.postSearch,
        semanticSearchQuery: s.semanticSearchQuery,
        semanticSearchRespectsTimeRange: s.semanticSearchRespectsTimeRange,
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
            activeProxies,
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
