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
import { queryKeys, SUMMARIZER_STALE_TIME } from "@/hooks/queryKeys"
import { useTagRunParam } from "@/hooks/useArtifactParams"
import {
  errorText,
  type ProvisionalRow,
  readStream,
  withMissingPosts,
  withProvisionalRow,
} from "@/lib/artifacts/artifact-run"
import {
  applyTagSuggestions,
  buildBulkChannelTagUpdates,
  normalizeParsedTagSuggestions,
} from "@/lib/channels/apply-tag-suggestions"
import { formatChannelsForPrompt } from "@/lib/channels/format-channels-for-prompt"
import { parseTagResponse } from "@/lib/channels/parse-tag-response"
import { bulkUpdateChannelTags } from "@/lib/channels/store"
import { formatAllTagsForPrompt } from "@/lib/channels/tag-prompt"
import {
  applicableSuggestions,
  appliedTagsMessage,
  completedTagRun,
  parsePastedTagSuggestions,
  pendingTagRun,
  tagRunSnapshot,
} from "@/lib/channels/tag-run"
import { tryWriteTextToClipboard } from "@/lib/data-transfer/clipboard"
import {
  deleteTagRun,
  getTagRun,
  listTagRuns,
  submitTagRun,
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
  /** The active tab's run; null on any other tab or an empty Tag tab. */
  currentRunId: string | null
  suggestions: Record<string, string[]>
  selectedRun: TagRun | null
  copyTagPrompt: () => Promise<void>
  generateTags: () => Promise<void>
  completePendingTagRun: (
    responseText: string,
    modelName?: string,
  ) => Promise<boolean>
  applyCurrentSuggestions: () => Promise<void>
}

const TagContext = createContext<TagContextType | undefined>(undefined)

export const TagProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { channels, selectedChannels, setChannels } = useData()
  const { getScopeSubmission } = useScraper()
  const { selectedModel, aiTemperature } = useSettings()
  const {
    activeTab,
    workspaceTabs,
    includeChannelBioInPrompt,
    includeChannelTagsInPrompt,
  } = useUI()
  const queryClient = useQueryClient()

  const [mode, setMode] = useState<TagMode>("add")
  const [isGenerating, setIsGenerating] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  // In the URL, so History's `?tagRun=` deep link actually opens a run — see
  // the note on `currentSummaryId` in `UIContext`.
  const { tagRunId: currentRunId } = useTagRunParam()
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

  // Each Tag tab shows its own run's suggestions, and an empty one none.
  useEffect(() => {
    setSuggestions(selectedRun?.suggestions ?? {})
  }, [selectedRun])

  /**
   * What this tab adds to a Tag run's prompt: the Channel descriptions and
   * the tags in use. The Posts are the run's Covered Posts, which the server
   * reads from the run it names (ADR-038).
   */
  const buildPromptParts = () => ({
    channelsText: formatChannelsForPrompt(channels, selectedChannels, {
      includeBio: includeChannelBioInPrompt,
      includeTags: includeChannelTagsInPrompt,
    }),
    allTags: formatAllTagsForPrompt(channels),
  })

  /** The opened run's prompt body: its id, never a Scope. */
  const promptBody = (
    tagRunId: string,
    parts: ReturnType<typeof buildPromptParts>,
  ) => ({
    tagRunId,
    channelsText: parts.channelsText,
    allTags: parts.allTags,
    tagMode: mode,
    model: selectedModel,
    temperature: aiTemperature,
  })

  /**
   * Open the run at a frozen Scope, before the prompt is assembled (AW-06).
   *
   * Both entry points go through here, and both needed it. A tag run is
   * written at least twice — `copyTagPrompt` opens it pending and the pasted
   * response completes it, `generateTags` writes it after the stream — so with
   * a Live window the prompt was built from one window and the row recorded
   * another.
   */
  const openTagRun = async (source: "generated" | "pasted") =>
    submitTagRun({
      id: crypto.randomUUID(),
      scope: getScopeSubmission(selectedChannelNames),
      mode,
      source,
      status: "pending",
      model: selectedModel,
    })

  const channelContextOptions = () => ({
    includeBio: includeChannelBioInPrompt,
    includeTags: includeChannelTagsInPrompt,
  })

  const copyTagPrompt = async () => {
    if (selectedChannelNames.length === 0) {
      toast.error("Select at least one channel first.")
      return
    }
    const parts = buildPromptParts()
    // Submission opens the row, so a prompt that never gets built has to take
    // it back — otherwise a failed copy litters History with a `pending` run
    // nobody can complete. The same compensation `AIContext` makes, for the
    // same reason.
    const opened = await openTagRun("pasted")
    try {
      const { prompt, missingPosts } = await getTagPrompt(
        promptBody(opened.id, parts),
      )
      const saved = await upsertTagRun({
        ...opened,
        promptText: prompt,
        ...withMissingPosts(missingPosts),
        ...tagRunSnapshot(parts.allTags, channelContextOptions()),
      })
      applySavedRun(saved)
      // Its tab opens without leaving Action, where the paste box is.
      workspaceTabs.createTab("tag", saved.id, { background: true })
      await tryWriteTextToClipboard(prompt)
      toast.success("Tag prompt copied. Paste the AI response when ready.")
    } catch (error) {
      await deleteTagRun(opened.id).catch(() => {})
      throw error
    }
  }

  const generateTags = async () => {
    if (selectedChannelNames.length === 0) {
      toast.error("Select at least one channel first.")
      return
    }
    const parts = buildPromptParts()
    setIsGenerating(true)
    // Opened before the first token is spent, and taken back if nothing comes
    // of it — see the note in `copyTagPrompt`.
    try {
      await withProvisionalRow(deleteTagRun, (row) => runTagging(parts, row))
    } catch (error) {
      console.error(error)
      toast.error(errorText(error, "Failed to generate tags"))
    } finally {
      setIsGenerating(false)
    }
  }

  const runTagging = async (
    parts: ReturnType<typeof buildPromptParts>,
    row: ProvisionalRow,
  ) => {
    const opened = await openTagRun("generated")
    row.opened(opened.id)
    const { stream, prompt, missingPosts } = await generateTagStream(
      promptBody(opened.id, parts),
    )
    const { text: responseText } = await readStream(stream)
    const parsed = normalizeParsedTagSuggestions(
      parseTagResponse(responseText),
      channels,
    )
    setSuggestions(parsed)

    const saved = await upsertTagRun({
      ...opened,
      status: "completed",
      promptText: prompt,
      ...withMissingPosts(missingPosts()),
      responseText,
      suggestions: parsed,
      ...tagRunSnapshot(parts.allTags, channelContextOptions()),
    })
    row.keep()
    applySavedRun(saved)
    workspaceTabs.createTab("tag", saved.id)
    toast.success("Tag suggestions generated.")
  }

  const completePendingTagRun = async (
    responseText: string,
    modelName?: string,
  ): Promise<boolean> => {
    const pending = pendingTagRun(tagRuns, selectedRun)
    if (!pending) {
      toast.error("No pending tag run found. Use Copy Prompt first.")
      return false
    }

    try {
      const parsed = parsePastedTagSuggestions(responseText, channels)
      setSuggestions(parsed)
      const saved = await upsertTagRun(
        completedTagRun(pending, responseText, parsed, modelName, Date.now()),
      )
      applySavedRun(saved)
      workspaceTabs.createTab("tag", saved.id)
      toast.success(
        `Parsed tag suggestions for ${Object.keys(parsed).length} channel(s).`,
      )
      return true
    } catch (error) {
      toast.error(errorText(error, "Failed to parse pasted response"))
      return false
    }
  }

  const applyCurrentSuggestions = async () => {
    const target = applicableSuggestions(selectedRun, suggestions)
    if (!target) {
      toast.error("No parsed suggestions to apply.")
      return
    }

    const { result, updatedChannels } = applyTagSuggestions({
      suggestions: target.suggestions,
      channels,
      mode: target.run.mode,
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

      const saved = await upsertTagRun({
        ...target.run,
        status: "completed",
        updatedAt: Date.now(),
        applyResult: result,
      })
      applySavedRun(saved)

      toast.dismiss(applyingToastId)
      toast.success(appliedTagsMessage(target.run.mode, result))
    } catch (error) {
      toast.dismiss(applyingToastId)
      toast.error(errorText(error, "Failed to apply tag suggestions"))
    } finally {
      setIsApplying(false)
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
        suggestions,
        selectedRun,
        copyTagPrompt,
        generateTags,
        completePendingTagRun,
        applyCurrentSuggestions,
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
