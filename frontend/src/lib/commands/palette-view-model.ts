import { isNonChannelEntityFlow } from "@/lib/commands/entity-candidates"
import type {
  CommandDef,
  EditorFieldDef,
  EntityFlowType,
  SearchResultsKind,
  SearchResultsState,
} from "@/lib/commands/types"
import type { Channel, Post, Summary } from "@/types"

/** Non-channel entity candidate shape (summaries, posts, tags, tables, groups). */
export interface ExtendedEntityCandidate {
  id: string
  label: string
}

export type EntityCandidate = Channel | ExtendedEntityCandidate

/** Groups commands by their `group` field, preserving insertion order. */
export function groupPaletteCommands(
  commands: CommandDef[],
): Map<string, CommandDef[]> {
  const groups = new Map<string, CommandDef[]>()
  for (const command of commands) {
    const existing = groups.get(command.group) ?? []
    existing.push(command)
    groups.set(command.group, existing)
  }
  return groups
}

interface CommandListInputs {
  isEmptyQuery: boolean
  commands: CommandDef[]
  rankedCommands: CommandDef[]
  displayedRecents: CommandDef[]
}

/**
 * Grouped commands for the root list: ranked matches while searching,
 * otherwise all commands minus the ones already shown under Recent.
 */
export function getGroupedPaletteCommands({
  isEmptyQuery,
  commands,
  rankedCommands,
  displayedRecents,
}: CommandListInputs): Map<string, CommandDef[]> {
  if (!isEmptyQuery) return groupPaletteCommands(rankedCommands)
  const recentIds = new Set(displayedRecents.map((command) => command.id))
  const others = commands.filter((command) => !recentIds.has(command.id))
  return groupPaletteCommands(others)
}

/** Id of the command the selection highlight should start on. */
export function getFirstNavigableCommandId({
  isEmptyQuery,
  commands,
  rankedCommands,
  displayedRecents,
}: CommandListInputs): string {
  if (!isEmptyQuery) return rankedCommands[0]?.id ?? ""
  return (
    displayedRecents[0]?.id ??
    commands.find(
      (command) => !displayedRecents.some((recent) => recent.id === command.id),
    )?.id ??
    ""
  )
}

/** Filters non-channel entity candidates by label or id substring. */
export function filterExtendedEntityCandidates(
  items: ExtendedEntityCandidate[],
  query: string,
): ExtendedEntityCandidate[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return items
  return items.filter(
    (item) =>
      item.label.toLowerCase().includes(normalizedQuery) ||
      item.id.toLowerCase().includes(normalizedQuery),
  )
}

/** Id of the entity candidate the selection highlight should start on. */
export function getFirstEntityCandidateId(
  candidates: EntityCandidate[],
  flow: EntityFlowType,
): string {
  if (candidates.length === 0) return ""
  if (isNonChannelEntityFlow(flow)) {
    return (candidates[0] as ExtendedEntityCandidate).id
  }
  return (candidates[0] as Channel).name
}

/**
 * Resolves which entity a plain Enter press should pick. Channel flows prefer
 * an exact name match, then a prefix match, then the highlighted row.
 */
export function resolveEntityPickId({
  flow,
  entityQuery,
  candidates,
  selectedEntityId,
}: {
  flow: EntityFlowType
  entityQuery: string
  candidates: EntityCandidate[]
  selectedEntityId: string
}): string {
  if (isNonChannelEntityFlow(flow)) {
    return (
      selectedEntityId ||
      ((candidates[0] as ExtendedEntityCandidate | undefined)?.id ?? "")
    )
  }
  const q = entityQuery.trim().toLowerCase()
  const channels = candidates as Channel[]
  return (
    channels.find((channel) => channel.name.toLowerCase() === q)?.name ??
    channels.find((channel) => channel.name.toLowerCase().startsWith(q))
      ?.name ??
    selectedEntityId ??
    channels[0]?.name ??
    ""
  )
}

/** Filters already-fetched search results by a secondary text query. */
export function filterSearchResultItems(
  state: SearchResultsState | null,
  filterQuery: string,
): Post[] | Summary[] {
  if (!state) return []
  const query = filterQuery.trim().toLowerCase()
  if (!query) return state.items

  if (state.kind === "posts") {
    return (state.items as Post[]).filter((post) => {
      const haystack =
        `${post.channelName} ${post.text} ${post.date}`.toLowerCase()
      return haystack.includes(query)
    })
  }

  return (state.items as Summary[]).filter((summary) => {
    const haystack = [
      summary.channels.join(" "),
      summary.text,
      summary.promptText ?? "",
      summary.model ?? "",
      summary.note ?? "",
    ]
      .join(" ")
      .toLowerCase()
    return haystack.includes(query)
  })
}

/** Stable list value for a search-result row. */
export function getSearchResultItemId(
  item: Post | Summary,
  kind: SearchResultsKind,
): string {
  if (kind === "posts") {
    const post = item as Post
    return `${post.channelName}_${post.id}`
  }
  return (item as Summary).id
}

/** Id of the search result the selection highlight should start on. */
export function getFirstSearchResultId(
  items: Post[] | Summary[],
  kind: SearchResultsKind | undefined,
): string {
  if (items.length === 0) return ""
  if (kind === "posts") {
    const post = items[0] as Post
    return `${post.channelName}_${post.id}`
  }
  return (items[0] as Summary).id
}

/** HTML input type for the editor field, honoring the global-start-time mode. */
export function getEditorInputType(
  field: EditorFieldDef | undefined,
  globalStartTimeMode: "retention" | "relative" | "absolute",
): string {
  if (!field) return "text"
  if (field.id === "globalStartTimeValue") {
    return globalStartTimeMode === "absolute" ? "datetime-local" : "number"
  }
  return field.type === "number" ? "number" : "text"
}

/** HTML input step for the editor field. */
export function getEditorInputStep(
  field: EditorFieldDef | undefined,
): number | "any" | undefined {
  if (field?.step === "any") return "any"
  return field?.integer ? 1 : field?.step
}
