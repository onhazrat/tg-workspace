import { useQuery, useQueryClient } from "@tanstack/react-query"
import type React from "react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { toast } from "sonner"
import { api } from "@/api"
import { queryKeys, SUMMARIZER_STALE_TIME } from "@/hooks/queryKeys"
import {
  applyTagSuggestions,
  buildBulkChannelTagUpdates,
  normalizeParsedTagSuggestions,
} from "@/lib/channels/apply-tag-suggestions"
import { formatChannelsForPrompt } from "@/lib/channels/format-channels-for-prompt"
import { parseTagResponse } from "@/lib/channels/parse-tag-response"
import { bulkUpdateChannelTags } from "@/lib/channels/store"
import {
  formatAllTagsForPrompt,
  formatPostsForTagPrompt,
} from "@/lib/channels/tag-prompt"
import { tryWriteTextToClipboard } from "@/lib/data-transfer/clipboard"
import {
  deleteTagRun,
  getTagRun,
  listTagRuns,
  upsertTagRun,
} from "@/lib/summaries/store"
import { generateTagStream, getTagPrompt } from "@/services/ai"
import type { TagRun, TagRunSummary } from "@/types"
import { useData } from "./DataContext"
import { useScraper } from "./ScraperContext"
import { useSettings } from "./SettingsContext"
import { useUI } from "./UIContext"

type TagMode = "add" | "remove"

const EMPTY_RUNS: TagRunSummary[] = []

interface TagContextType {
  mode: TagMode
  setMode: React.Dispatch<React.SetStateAction<TagMode>>
  isGenerating: boolean
  isApplying: boolean
  /** Metadata only — `selectedRun` carries the heavy fields. */
  tagRuns: TagRunSummary[]
  currentRunId: string | null
  setCurrentRunId: React.Dispatch<React.SetStateAction<string | null>>
  suggestions: Record<string, string[]>
  selectedRun: TagRun | null
  copyTagPrompt: () => Promise<void>
  generateTags: () => Promise<void>
  completePendingTagRun: (
    responseText: string,
    modelName?: string,
  ) => Promise<boolean>
  applyCurrentSuggestions: () => Promise<void>
  deleteRun: (id: string) => Promise<void>
}

const TagContext = createContext<TagContextType | undefined>(undefined)

export const TagProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { channels, selectedChannels, setChannels } = useData()
  const { getPromptPostsInput } = useScraper()
  const { aiLanguage, selectedModel, aiTemperature } = useSettings()
  const {
    activeTab,
    startDate,
    endDate,
    includeChannelBioInPrompt,
    includeChannelTagsInPrompt,
  } = useUI()
  const queryClient = useQueryClient()

  const [mode, setMode] = useState<TagMode>("add")
  const [isGenerating, setIsGenerating] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [currentRunId, setCurrentRunId] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({})

  // TagProvider is mounted unconditionally, so an unguarded fetch here ran on
  // every page load whether or not the Tag tab was ever opened.
  const isTagTabActive = activeTab === "tag"

  const { data: tagRuns = EMPTY_RUNS } = useQuery({
    queryKey: queryKeys.tagRuns,
    queryFn: async () => {
      const runs = await listTagRuns()
      return [...runs].sort((a, b) => b.createdAt - a.createdAt)
    },
    enabled: isTagTabActive,
    staleTime: SUMMARIZER_STALE_TIME,
  })

  // The list carries metadata only; the selected run's heavy fields
  // (promptText, responseText, suggestions) are fetched on demand.
  const { data: selectedRun = null } = useQuery({
    queryKey: queryKeys.tagRun(currentRunId ?? ""),
    queryFn: () => getTagRun(currentRunId as string).then((r) => r ?? null),
    enabled: isTagTabActive && !!currentRunId,
    staleTime: SUMMARIZER_STALE_TIME,
  })

  const selectedChannelNames = useMemo(
    () =>
      channels
        .filter((channel) => selectedChannels.has(channel.name))
        .map((channel) => channel.name),
    [channels, selectedChannels],
  )

  /**
   * Reflect a saved run into the query cache: the summary into the list, the
   * full row into its detail entry. Writing both keeps the UI immediate
   * without a refetch, and keeps the two views consistent.
   */
  const applySavedRun = useCallback(
    (saved: TagRun) => {
      queryClient.setQueryData<TagRunSummary[]>(
        queryKeys.tagRuns,
        (prev = []) => [saved, ...prev.filter((e) => e.id !== saved.id)],
      )
      queryClient.setQueryData(queryKeys.tagRun(saved.id), saved)
    },
    [queryClient],
  )

  // Default the selection to the newest run once the list arrives.
  useEffect(() => {
    if (!currentRunId && tagRuns.length > 0) {
      setCurrentRunId(tagRuns[0].id)
    }
  }, [tagRuns, currentRunId])

  useEffect(() => {
    if (selectedRun?.suggestions) setSuggestions(selectedRun.suggestions)
  }, [selectedRun])

  const buildPromptParts = async () => {
    const channelsText = formatChannelsForPrompt(channels, selectedChannels, {
      includeBio: includeChannelBioInPrompt,
      includeTags: includeChannelTagsInPrompt,
    })
    const allTags = formatAllTagsForPrompt(channels)
    // Server-eligible → send the scope (backend assembles the tag posts block);
    // semantic/related → client-built postsText with the tag formatter.
    const input = await getPromptPostsInput()
    if (input.scope) {
      const counts = await api.getPostsCounts({
        channelNames: selectedChannelNames,
        ...input.scope,
      })
      const postCount = Object.values(counts).reduce((sum, n) => sum + n, 0)
      return {
        channelsText,
        postsText: "",
        allTags,
        postCount,
        scope: input.scope,
      }
    }
    const postsText = formatPostsForTagPrompt(input.posts, selectedChannels)
    return {
      channelsText,
      postsText,
      allTags,
      postCount: input.posts.length,
      scope: undefined,
    }
  }

  const copyTagPrompt = async () => {
    if (selectedChannelNames.length === 0) {
      toast.error("Select at least one channel first.")
      return
    }
    const { channelsText, postsText, allTags, postCount, scope } =
      await buildPromptParts()
    const prompt = await getTagPrompt({
      channels: selectedChannelNames,
      channelsText,
      postsText,
      allTags,
      tagMode: mode,
      language: aiLanguage,
      model: selectedModel,
      temperature: aiTemperature,
      scope,
    })
    const run: TagRun = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "pending",
      source: "pasted",
      mode,
      channels: selectedChannelNames,
      startDate,
      endDate,
      postCount,
      model: selectedModel,
      promptText: prompt,
      allTagsSnapshot: allTags === "(none yet)" ? [] : allTags.split(", "),
      channelContextOptions: {
        includeBio: includeChannelBioInPrompt,
        includeTags: includeChannelTagsInPrompt,
      },
    }
    const saved = await upsertTagRun(run)
    applySavedRun(saved)
    setCurrentRunId(saved.id)
    await tryWriteTextToClipboard(prompt)
    toast.success("Tag prompt copied. Paste the AI response when ready.")
  }

  const generateTags = async () => {
    if (selectedChannelNames.length === 0) {
      toast.error("Select at least one channel first.")
      return
    }
    const { channelsText, postsText, allTags, postCount, scope } =
      await buildPromptParts()
    setIsGenerating(true)
    try {
      let responseText = ""
      const { stream, prompt } = await generateTagStream({
        channels: selectedChannelNames,
        channelsText,
        postsText,
        allTags,
        tagMode: mode,
        language: aiLanguage,
        model: selectedModel,
        temperature: aiTemperature,
        scope,
      })

      for await (const chunk of stream) {
        responseText += chunk.text
      }
      const parsed = normalizeParsedTagSuggestions(
        parseTagResponse(responseText),
        channels,
      )
      setSuggestions(parsed)

      const run: TagRun = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "completed",
        source: "generated",
        mode,
        channels: selectedChannelNames,
        startDate,
        endDate,
        postCount,
        model: selectedModel,
        promptText: prompt,
        responseText,
        suggestions: parsed,
        allTagsSnapshot: allTags === "(none yet)" ? [] : allTags.split(", "),
        channelContextOptions: {
          includeBio: includeChannelBioInPrompt,
          includeTags: includeChannelTagsInPrompt,
        },
      }
      const saved = await upsertTagRun(run)
      applySavedRun(saved)
      setCurrentRunId(saved.id)
      toast.success("Tag suggestions generated.")
    } catch (error) {
      console.error(error)
      toast.error(
        error instanceof Error ? error.message : "Failed to generate tags",
      )
    } finally {
      setIsGenerating(false)
    }
  }

  const completePendingTagRun = async (
    responseText: string,
    modelName?: string,
  ): Promise<boolean> => {
    const pending =
      tagRuns.find((run) => run.status === "pending") ?? selectedRun
    if (!pending) {
      toast.error("No pending tag run found. Use Copy Prompt first.")
      return false
    }

    try {
      const parsed = normalizeParsedTagSuggestions(
        parseTagResponse(responseText),
        channels,
      )
      if (Object.keys(parsed).length === 0) {
        throw new Error(
          "No channel names in the response matched your channels.",
        )
      }
      setSuggestions(parsed)
      const updated: TagRun = {
        ...pending,
        status: "completed",
        responseText: responseText.trim(),
        suggestions: parsed,
        model: modelName?.trim() || pending.model || "external",
        updatedAt: Date.now(),
      }
      const saved = await upsertTagRun(updated)
      applySavedRun(saved)
      setCurrentRunId(saved.id)
      toast.success(
        `Parsed tag suggestions for ${Object.keys(parsed).length} channel(s).`,
      )
      return true
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to parse pasted response",
      )
      return false
    }
  }

  const applyCurrentSuggestions = async () => {
    const activeRun = selectedRun
    const suggestionSource = activeRun?.suggestions ?? suggestions
    if (!activeRun || Object.keys(suggestionSource).length === 0) {
      toast.error("No parsed suggestions to apply.")
      return
    }

    const { result, updatedChannels } = applyTagSuggestions({
      suggestions: suggestionSource,
      channels,
      mode: activeRun.mode,
      selectedChannelNames: selectedChannelNames,
    })

    if (updatedChannels.length === 0) {
      toast.info("No tag changes to apply for the selected channels.")
      return
    }

    const applyingToastId = toast.loading(
      `Applying tags to ${updatedChannels.length} channel(s)...`,
    )
    setIsApplying(true)

    try {
      const bulkResult = await bulkUpdateChannelTags(
        buildBulkChannelTagUpdates(updatedChannels),
      )

      const updatedById = new Map(
        bulkResult.channels.map((channel) => [channel.id, channel]),
      )
      setChannels((prev) =>
        prev.map((entry) => updatedById.get(entry.id) ?? entry),
      )

      const updatedRun: TagRun = {
        ...activeRun,
        status: "completed",
        updatedAt: Date.now(),
        applyResult: result,
      }
      const saved = await upsertTagRun(updatedRun)
      applySavedRun(saved)

      toast.dismiss(applyingToastId)
      if (activeRun.mode === "add") {
        toast.success(
          `Added ${result.tagsAdded} tags to ${result.channelsUpdated} channels.`,
        )
        return
      }
      toast.success(
        `Removed ${result.tagsRemoved} tags from ${result.channelsUpdated} channels.`,
      )
    } catch (error) {
      toast.dismiss(applyingToastId)
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to apply tag suggestions",
      )
    } finally {
      setIsApplying(false)
    }
  }

  const handleDeleteRun = async (id: string) => {
    await deleteTagRun(id)
    const next = queryClient.setQueryData<TagRunSummary[]>(
      queryKeys.tagRuns,
      (prev = []) => prev.filter((entry) => entry.id !== id),
    )
    queryClient.removeQueries({ queryKey: queryKeys.tagRun(id) })
    if (currentRunId === id) {
      setCurrentRunId(next?.[0]?.id ?? null)
      setSuggestions({})
    }
  }

  return (
    <TagContext.Provider
      value={{
        mode,
        setMode,
        isGenerating,
        isApplying,
        tagRuns,
        currentRunId,
        setCurrentRunId,
        suggestions,
        selectedRun,
        copyTagPrompt,
        generateTags,
        completePendingTagRun,
        applyCurrentSuggestions,
        deleteRun: handleDeleteRun,
      }}
    >
      {children}
    </TagContext.Provider>
  )
}

export function useTagContext() {
  const context = useContext(TagContext)
  if (context === undefined) {
    throw new Error("useTagContext must be used within a TagProvider")
  }
  return context
}
