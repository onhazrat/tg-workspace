/**
 * The rules `TagContext`'s run actions follow, with no React and no I/O, so
 * they can be tested directly. The context keeps the saving and the state.
 */
import type { Channel, TagRun, TagRunSummary } from "@/types"
import {
  normalizeParsedTagSuggestions,
  type TagApplyResult,
} from "./apply-tag-suggestions"
import { parseTagResponse } from "./parse-tag-response"

type Suggestions = Record<string, string[]>

/** What a run records about its prompt's inputs: the tag vocabulary and the channel context. */
export function tagRunSnapshot(
  allTags: string,
  channelContextOptions: { includeBio: boolean; includeTags: boolean },
): Pick<TagRun, "allTagsSnapshot" | "channelContextOptions"> {
  return {
    // `formatAllTagsForPrompt`'s placeholder for an empty vocabulary.
    allTagsSnapshot: allTags === "(none yet)" ? [] : allTags.split(", "),
    channelContextOptions,
  }
}

/** The run a pasted response completes: the first pending one, else the one on screen. */
export function pendingTagRun(
  runs: TagRunSummary[],
  selected: TagRun | null,
): TagRunSummary | null {
  return runs.find((run) => run.status === "pending") ?? selected
}

/** Suggestions for your channels in a pasted response; throws when it names none of them. */
export function parsePastedTagSuggestions(
  responseText: string,
  channels: Channel[],
): Suggestions {
  const parsed = normalizeParsedTagSuggestions(
    parseTagResponse(responseText),
    channels,
  )
  if (Object.keys(parsed).length === 0)
    throw new Error("No channel names in the response matched your channels.")
  return parsed
}

/** The completed run a pasted response writes. A model typed beside the paste wins. */
export function completedTagRun(
  pending: TagRunSummary,
  responseText: string,
  suggestions: Suggestions,
  modelName: string | undefined,
  now: number,
): TagRun {
  return {
    ...pending,
    status: "completed",
    responseText: responseText.trim(),
    suggestions,
    model: modelName?.trim() || pending.model || "external",
    updatedAt: now,
  }
}

/** The run to apply and its suggestions: the saved ones, else the live ones; null when there is nothing. */
export function applicableSuggestions(
  run: TagRun | null,
  live: Suggestions,
): { run: TagRun; suggestions: Suggestions } | null {
  const suggestions = run?.suggestions ?? live
  if (!run || Object.keys(suggestions).length === 0) return null
  return { run, suggestions }
}

export const appliedTagsMessage = (
  mode: TagRun["mode"],
  result: TagApplyResult,
): string =>
  mode === "add"
    ? `Added ${result.tagsAdded} tags to ${result.channelsUpdated} channels.`
    : `Removed ${result.tagsRemoved} tags from ${result.channelsUpdated} channels.`
