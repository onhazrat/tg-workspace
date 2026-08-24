import { scopedStorage } from "@/lib/storage/scoped"
import type { AffinityEntry, CommandDef, RankedCommand } from "./types"

export const AFFINITY_STORAGE_KEY = "commandPaletteSearchAffinity"
export const AFFINITY_MAX_ENTRIES = 1000
export const AFFINITY_WEIGHT = 0.35
const RECENCY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ")
}

function tokenize(value: string): string[] {
  return normalizeQuery(value).split(" ").filter(Boolean)
}

export function querySimilarity(
  inputQuery: string,
  storedQuery: string,
): number {
  const input = normalizeQuery(inputQuery)
  const stored = normalizeQuery(storedQuery)
  if (!input || !stored) return 0
  if (input === stored) return 1
  if (stored.startsWith(input) || input.startsWith(stored)) return 0.8

  const inputTokens = tokenize(input)
  const storedTokens = tokenize(stored)
  if (inputTokens.length === 0 || storedTokens.length === 0) return 0

  const overlap = inputTokens.filter((token) =>
    storedTokens.includes(token),
  ).length
  const overlapRatio =
    overlap / Math.max(inputTokens.length, storedTokens.length)
  if (overlapRatio > 0) return 0.5 * overlapRatio

  if (stored.includes(input) || input.includes(stored)) return 0.4
  return fuzzyIncludes(input, stored) ? 0.3 : 0
}

function fuzzyIncludes(needle: string, haystack: string): boolean {
  let haystackIndex = 0
  for (const char of needle) {
    haystackIndex = haystack.indexOf(char, haystackIndex)
    if (haystackIndex === -1) return false
    haystackIndex += 1
  }
  return true
}

function recencyDecay(lastUsedAt: number, now = Date.now()): number {
  const ageMs = Math.max(0, now - lastUsedAt)
  return Math.exp((-ageMs * Math.LN2) / RECENCY_HALF_LIFE_MS)
}

export function affinityBoost(
  commandId: string,
  inputQuery: string,
  entries: AffinityEntry[],
  now = Date.now(),
): number {
  const normalized = normalizeQuery(inputQuery)
  if (!normalized) return 0

  return entries.reduce((total, entry) => {
    if (entry.commandId !== commandId) return total
    const similarity = querySimilarity(normalized, entry.query)
    if (similarity <= 0) return total
    return (
      total +
      similarity * Math.log1p(entry.count) * recencyDecay(entry.lastUsedAt, now)
    )
  }, 0)
}

function cmdkScore(command: CommandDef, query: string): number {
  const normalized = normalizeQuery(query)
  if (!normalized) return 1

  const haystacks = [
    command.label,
    command.group,
    ...command.keywords,
    command.id.replace(/-/g, " "),
  ].map((value) => normalizeQuery(value))

  let best = 0
  for (const haystack of haystacks) {
    if (!haystack) continue
    if (haystack === normalized) best = Math.max(best, 1)
    else if (haystack.startsWith(normalized)) best = Math.max(best, 0.9)
    else if (haystack.includes(normalized)) best = Math.max(best, 0.75)
    else if (fuzzyIncludes(normalized, haystack)) best = Math.max(best, 0.55)
  }

  if (command.id.startsWith("navigate-tab-")) {
    const tabId = command.id.slice("navigate-tab-".length)
    if (tabId === normalized) best = Math.max(best, 1.15)
  }

  return best
}

export function filterAndRank(
  commands: CommandDef[],
  query: string,
  affinityEntries: AffinityEntry[],
): RankedCommand[] {
  const normalized = normalizeQuery(query)
  if (!normalized) {
    return commands.map((command) => ({ command, score: 1 }))
  }

  const ranked = commands
    .map((command) => {
      const base = cmdkScore(command, normalized)
      if (base <= 0) return null
      const boost = affinityBoost(command.id, normalized, affinityEntries)
      return {
        command,
        score: base + boost * AFFINITY_WEIGHT,
      }
    })
    .filter((entry): entry is RankedCommand => entry !== null)

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.command.label.localeCompare(b.command.label)
  })

  return ranked
}

export function loadAffinityEntries(): AffinityEntry[] {
  if (typeof window === "undefined") return []
  try {
    const raw = scopedStorage.getItem(AFFINITY_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as AffinityEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveAffinityEntries(entries: AffinityEntry[]): void {
  if (typeof window === "undefined") return
  scopedStorage.setItem(AFFINITY_STORAGE_KEY, JSON.stringify(entries))
}

export function recordAffinityPick(
  query: string,
  commandId: string,
  entries: AffinityEntry[],
): AffinityEntry[] {
  const normalized = normalizeQuery(query)
  if (!normalized) return entries

  const now = Date.now()
  const existing = entries.find(
    (entry) => entry.query === normalized && entry.commandId === commandId,
  )

  let next: AffinityEntry[]
  if (existing) {
    next = entries.map((entry) =>
      entry === existing
        ? { ...entry, count: entry.count + 1, lastUsedAt: now }
        : entry,
    )
  } else {
    next = [
      ...entries,
      { query: normalized, commandId, count: 1, lastUsedAt: now },
    ]
  }

  if (next.length <= AFFINITY_MAX_ENTRIES) return next

  return [...next]
    .sort((a, b) => {
      const scoreA = Math.log1p(a.count) * recencyDecay(a.lastUsedAt, now)
      const scoreB = Math.log1p(b.count) * recencyDecay(b.lastUsedAt, now)
      return scoreA - scoreB
    })
    .slice(next.length - AFFINITY_MAX_ENTRIES)
}
