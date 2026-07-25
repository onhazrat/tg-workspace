import { normalizeQuery } from "@/lib/commands/rank-commands"
import { SETTINGS_CATALOG } from "./catalog"
import type {
  ParsedSettingsQuery,
  SettingCatalogEntry,
  SettingsFeatureGroup,
  SettingsSearchHit,
  SettingsSearchProvider,
} from "./catalog-types"

const FEATURE_GROUPS: readonly SettingsFeatureGroup[] = [
  "appearance",
  "channels-sync",
  "ai",
  "network",
  "publishing",
  "data",
  "tools",
  "jobs",
] as const

function fuzzyIncludes(needle: string, haystack: string): boolean {
  let haystackIndex = 0
  for (const char of needle) {
    haystackIndex = haystack.indexOf(char, haystackIndex)
    if (haystackIndex === -1) return false
    haystackIndex += 1
  }
  return true
}

function scoreHaystack(haystack: string, query: string): number {
  const h = normalizeQuery(haystack)
  if (!h || !query) return 0
  if (h === query) return 1
  if (h.startsWith(query)) return 0.9
  if (h.includes(query)) return 0.75
  if (fuzzyIncludes(query, h)) return 0.55
  return 0
}

function entryScore(entry: SettingCatalogEntry, query: string): number {
  const enumLabels =
    entry.control.kind === "enum"
      ? entry.control.options.map((o) => o.label)
      : []
  const haystacks = [
    entry.id,
    entry.label,
    entry.description,
    entry.group,
    ...entry.keywords,
    ...enumLabels,
  ]
  let best = 0
  for (const hay of haystacks) {
    best = Math.max(best, scoreHaystack(hay, query))
  }
  return best
}

const OPERATOR_RE = /@([a-z]+)(?::([^\s]+))?/gi

export function parseSettingsQuery(raw: string): ParsedSettingsQuery {
  let modifiedOnly = false
  let feature: SettingsFeatureGroup | undefined
  let id: string | undefined
  const textParts: string[] = []
  let lastIndex = 0
  const input = raw

  for (const match of input.matchAll(OPERATOR_RE)) {
    const start = match.index ?? 0
    if (start > lastIndex) {
      textParts.push(input.slice(lastIndex, start))
    }
    lastIndex = start + match[0].length
    const op = match[1]?.toLowerCase()
    const arg = match[2]
    if (op === "modified") {
      modifiedOnly = true
    } else if (op === "feature" && arg) {
      const candidate = arg.toLowerCase() as SettingsFeatureGroup
      if ((FEATURE_GROUPS as readonly string[]).includes(candidate)) {
        feature = candidate
      }
    } else if (op === "id" && arg) {
      id = arg
    }
  }
  if (lastIndex < input.length) textParts.push(input.slice(lastIndex))

  return {
    text: normalizeQuery(textParts.join(" ")),
    modifiedOnly,
    feature,
    id,
  }
}

export function suggestSettingsOperators(query: string): string[] {
  const trimmed = query.trim()
  if (!trimmed.startsWith("@") && !trimmed.endsWith("@")) {
    if (!trimmed.includes("@")) return []
  }
  const atIndex = trimmed.lastIndexOf("@")
  if (atIndex === -1) return []
  const fragment = trimmed.slice(atIndex + 1).toLowerCase()
  if (fragment.includes(" ")) return []

  const suggestions = [
    "@modified",
    ...FEATURE_GROUPS.map((g) => `@feature:${g}`),
    "@id:",
  ]
  if (!fragment) return suggestions
  return suggestions.filter((s) => s.slice(1).startsWith(fragment))
}

/** Local string-ranking search provider (embeddings-ready seam). */
export function createLocalSettingsSearchProvider(
  defaultEntries: SettingCatalogEntry[] = SETTINGS_CATALOG,
): SettingsSearchProvider {
  return {
    search(query, options) {
      const entries = options?.entries ?? defaultEntries
      const parsed = parseSettingsQuery(query)
      let filtered = entries.filter((e) => !e.searchHidden)

      if (parsed.id) {
        filtered = filtered.filter((e) => e.id === parsed.id)
      }
      if (parsed.feature) {
        filtered = filtered.filter((e) => e.group === parsed.feature)
      }
      if (parsed.modifiedOnly && options?.isModified) {
        filtered = filtered.filter((e) => options.isModified?.(e))
      }

      if (
        !parsed.text &&
        !parsed.id &&
        !parsed.feature &&
        !parsed.modifiedOnly
      ) {
        return []
      }

      if (!parsed.text) {
        return filtered.map((entry) => ({ entry, score: 1 }))
      }

      const hits: SettingsSearchHit[] = []
      for (const entry of filtered) {
        const score = entryScore(entry, parsed.text)
        if (score > 0) hits.push({ entry, score })
      }
      hits.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return a.entry.label.localeCompare(b.entry.label)
      })
      return hits
    },
  }
}

export const localSettingsSearch = createLocalSettingsSearchProvider()

export function searchSettings(
  query: string,
  options?: {
    entries?: SettingCatalogEntry[]
    isModified?: (entry: SettingCatalogEntry) => boolean
    provider?: SettingsSearchProvider
  },
): SettingsSearchHit[] {
  const provider = options?.provider ?? localSettingsSearch
  return provider.search(query, {
    entries: options?.entries,
    isModified: options?.isModified,
  })
}

// Re-export types used by consumers from catalog barrel
export type {
  ParsedSettingsQuery,
  SettingCatalogEntry,
  SettingsFeatureGroup,
  SettingsSearchHit,
  SettingsSearchProvider,
}
