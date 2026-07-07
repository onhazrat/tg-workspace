import type { ChannelTag, TagSource } from "@/types"

const DEFAULT_LEGACY_ASSIGNED_AT = 0

function normalizeTagName(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const name = raw.trim()
  return name ? name : null
}

function normalizeTagSource(raw: unknown): TagSource {
  return raw === "ai" ? "ai" : "manual"
}

function normalizeAssignedAt(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return raw
  }
  return DEFAULT_LEGACY_ASSIGNED_AT
}

export function normalizeChannelTags(raw: unknown): ChannelTag[] {
  if (!Array.isArray(raw)) return []
  const deduped = new Map<string, ChannelTag>()
  for (const entry of raw) {
    if (typeof entry === "string") {
      const name = normalizeTagName(entry)
      if (!name) continue
      const key = name.toLowerCase()
      if (deduped.has(key)) continue
      deduped.set(key, {
        name,
        source: "manual",
        assignedAt: DEFAULT_LEGACY_ASSIGNED_AT,
      })
      continue
    }
    if (!entry || typeof entry !== "object") continue
    const maybeName = normalizeTagName((entry as { name?: unknown }).name)
    if (!maybeName) continue
    const key = maybeName.toLowerCase()
    if (deduped.has(key)) continue
    deduped.set(key, {
      name: maybeName,
      source: normalizeTagSource((entry as { source?: unknown }).source),
      assignedAt: normalizeAssignedAt(
        (entry as { assignedAt?: unknown }).assignedAt,
      ),
    })
  }
  return [...deduped.values()]
}

export function getTagNames(raw: unknown): string[] {
  return normalizeChannelTags(raw).map((tag) => tag.name)
}

export function addManualTag(
  existing: unknown,
  rawName: string,
  now = Date.now(),
): ChannelTag[] {
  const name = normalizeTagName(rawName)
  if (!name) return normalizeChannelTags(existing)
  if (name.toLowerCase().startsWith("group:")) {
    return normalizeChannelTags(existing)
  }
  const normalized = normalizeChannelTags(existing)
  if (normalized.some((tag) => tag.name.toLowerCase() === name.toLowerCase())) {
    return normalized
  }
  return [...normalized, { name, source: "manual", assignedAt: now }]
}

export function mergeAiTags(
  existing: unknown,
  proposedNames: string[],
  now = Date.now(),
): ChannelTag[] {
  const merged = normalizeChannelTags(existing)
  const existingKeys = new Set(merged.map((tag) => tag.name.toLowerCase()))
  for (const rawName of proposedNames) {
    const name = normalizeTagName(rawName)
    if (!name) continue
    const key = name.toLowerCase()
    if (existingKeys.has(key)) continue
    merged.push({ name, source: "ai", assignedAt: now })
    existingKeys.add(key)
  }
  return merged
}

export function removeTagsByName(
  existing: unknown,
  proposedNames: string[],
): ChannelTag[] {
  const removeKeys = new Set(
    proposedNames
      .map((name) => normalizeTagName(name))
      .filter((name): name is string => Boolean(name))
      .map((name) => name.toLowerCase()),
  )
  if (removeKeys.size === 0) return normalizeChannelTags(existing)
  return normalizeChannelTags(existing).filter(
    (tag) => !removeKeys.has(tag.name.toLowerCase()),
  )
}

export function removeAiTags(
  existing: unknown,
  proposedNames: string[],
): ChannelTag[] {
  return removeTagsByName(existing, proposedNames)
}
