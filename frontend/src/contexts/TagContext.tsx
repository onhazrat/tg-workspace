import type React from "react"
import { createContext, useContext, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { formatChannelsForPrompt } from "@/lib/channels/format-channels-for-prompt"
import { parseTagResponse } from "@/lib/channels/parse-tag-response"
import {
  formatAllTagsForPrompt,
  formatPostsForTagPrompt,
} from "@/lib/channels/tag-prompt"
import {
  deleteTagRun,
  listTagRuns,
  upsertChannel,
  upsertTagRun,
} from "@/lib/repository"
import { generateTagStream, getTagPrompt } from "@/services/ai"
import type { TagRun } from "@/types"
import { mergeAiTags, removeAiTags } from "../lib/channels/channel-tag-model"
import { useData } from "./DataContext"
import { useScraper } from "./ScraperContext"
import { useSettings } from "./SettingsContext"
import { useUI } from "./UIContext"

type TagMode = "add" | "remove"

interface TagContextType {
  mode: TagMode
  setMode: React.Dispatch<React.SetStateAction<TagMode>>
  isGenerating: boolean
  tagRuns: TagRun[]
  currentRunId: string | null
  setCurrentRunId: React.Dispatch<React.SetStateAction<string | null>>
  suggestions: Record<string, string[]>
  selectedRun: TagRun | null
  copyTagPrompt: () => Promise<void>
  generateTags: () => Promise<void>
  completePendingTagRun: (responseText: string, modelName?: string) => Promise<boolean>
  applyCurrentSuggestions: () => Promise<void>
  deleteRun: (id: string) => Promise<void>
}

const TagContext = createContext<TagContextType | undefined>(undefined)

export const TagProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { channels, selectedChannels, setChannels, loadChannels } = useData()
  const { filteredPosts } = useScraper()
  const { aiLanguage, selectedModel, aiTemperature } = useSettings()
  const {
    startDate,
    endDate,
    includeChannelBioInPrompt,
    includeChannelTagsInPrompt,
  } = useUI()

  const [mode, setMode] = useState<TagMode>("add")
  const [isGenerating, setIsGenerating] = useState(false)
  const [tagRuns, setTagRuns] = useState<TagRun[]>([])
  const [currentRunId, setCurrentRunId] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({})

  const selectedChannelNames = useMemo(
    () =>
      channels
        .filter((channel) => selectedChannels.has(channel.name))
        .map((channel) => channel.name),
    [channels, selectedChannels],
  )

  const selectedRun = useMemo(
    () => tagRuns.find((run) => run.id === currentRunId) ?? null,
    [tagRuns, currentRunId],
  )

  useEffect(() => {
    void (async () => {
      const runs = await listTagRuns()
      const sorted = [...runs].sort((a, b) => b.createdAt - a.createdAt)
      setTagRuns(sorted)
      if (!currentRunId && sorted.length > 0) {
        setCurrentRunId(sorted[0].id)
      }
    })()
  }, [])

  useEffect(() => {
    if (selectedRun?.suggestions) setSuggestions(selectedRun.suggestions)
  }, [selectedRun])

  const buildPromptParts = () => {
    const channelsText = formatChannelsForPrompt(channels, selectedChannels, {
      includeBio: includeChannelBioInPrompt,
      includeTags: includeChannelTagsInPrompt,
    })
    const postsText = formatPostsForTagPrompt(filteredPosts, selectedChannels)
    const allTags = formatAllTagsForPrompt(channels)
    return { channelsText, postsText, allTags }
  }

  const copyTagPrompt = async () => {
    if (selectedChannelNames.length === 0) {
      toast.error("Select at least one channel first.")
      return
    }
    const { channelsText, postsText, allTags } = buildPromptParts()
    const prompt = await getTagPrompt({
      channels: selectedChannelNames,
      channelsText,
      postsText,
      allTags,
      tagMode: mode,
      language: aiLanguage,
      model: selectedModel,
      temperature: aiTemperature,
    })
    await navigator.clipboard.writeText(prompt)

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
      postCount: filteredPosts.length,
      model: selectedModel,
      promptText: prompt,
      allTagsSnapshot: allTags === "(none yet)" ? [] : allTags.split(", "),
      channelContextOptions: {
        includeBio: includeChannelBioInPrompt,
        includeTags: includeChannelTagsInPrompt,
      },
    }
    const saved = await upsertTagRun(run)
    setTagRuns((prev) => [saved, ...prev.filter((entry) => entry.id !== saved.id)])
    setCurrentRunId(saved.id)
    toast.success("Tag prompt copied. Paste the AI response when ready.")
  }

  const generateTags = async () => {
    if (selectedChannelNames.length === 0) {
      toast.error("Select at least one channel first.")
      return
    }
    const { channelsText, postsText, allTags } = buildPromptParts()
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
      })

      for await (const chunk of stream) {
        responseText += chunk.text
      }
      const parsed = parseTagResponse(responseText)
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
        postCount: filteredPosts.length,
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
      setTagRuns((prev) => [saved, ...prev.filter((entry) => entry.id !== saved.id)])
      setCurrentRunId(saved.id)
      toast.success("Tag suggestions generated.")
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Failed to generate tags")
    } finally {
      setIsGenerating(false)
    }
  }

  const completePendingTagRun = async (
    responseText: string,
    modelName?: string,
  ): Promise<boolean> => {
    const pending = selectedRun ?? tagRuns.find((run) => run.status === "pending")
    if (!pending) {
      toast.error("No pending tag run found. Use Copy Prompt first.")
      return false
    }

    try {
      const parsed = parseTagResponse(responseText)
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
      setTagRuns((prev) =>
        prev.map((entry) => (entry.id === saved.id ? saved : entry)),
      )
      setCurrentRunId(saved.id)
      toast.success("Tag run completed from pasted response.")
      return true
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to parse pasted response",
      )
      return false
    }
  }

  const applyCurrentSuggestions = async () => {
    const activeRun = selectedRun
    if (!activeRun || !activeRun.suggestions) {
      toast.error("No parsed suggestions to apply.")
      return
    }
    let channelsUpdated = 0
    let tagsAdded = 0
    let tagsRemoved = 0

    for (const [channelName, proposedTags] of Object.entries(activeRun.suggestions)) {
      const channel = channels.find((entry) => entry.name === channelName)
      if (!channel) continue
      const nextTags =
        activeRun.mode === "add"
          ? mergeAiTags(channel.tags, proposedTags)
          : removeAiTags(channel.tags, proposedTags)
      if (JSON.stringify(nextTags) === JSON.stringify(channel.tags ?? [])) continue
      if (activeRun.mode === "add") {
        tagsAdded += nextTags.length - (channel.tags?.length ?? 0)
      } else {
        tagsRemoved += (channel.tags?.length ?? 0) - nextTags.length
      }
      const updatedChannel = { ...channel, tags: nextTags }
      await upsertChannel(updatedChannel)
      channelsUpdated += 1
      setChannels((prev) =>
        prev.map((entry) =>
          entry.id === updatedChannel.id ? updatedChannel : entry,
        ),
      )
    }

    const updatedRun: TagRun = {
      ...activeRun,
      status: "completed",
      updatedAt: Date.now(),
      applyResult: { channelsUpdated, tagsAdded, tagsRemoved },
    }
    const saved = await upsertTagRun(updatedRun)
    setTagRuns((prev) =>
      prev.map((entry) => (entry.id === saved.id ? saved : entry)),
    )
    await loadChannels()

    if (activeRun.mode === "add") {
      toast.success(`Added ${tagsAdded} tags to ${channelsUpdated} channels.`)
      return
    }
    toast.success(`Removed ${tagsRemoved} tags from ${channelsUpdated} channels.`)
  }

  const handleDeleteRun = async (id: string) => {
    await deleteTagRun(id)
    setTagRuns((prev) => {
      const next = prev.filter((entry) => entry.id !== id)
      if (currentRunId === id) {
        setCurrentRunId(next[0]?.id ?? null)
      }
      return next
    })
    if (currentRunId === id) {
      setSuggestions({})
    }
  }

  return (
    <TagContext.Provider
      value={{
        mode,
        setMode,
        isGenerating,
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
