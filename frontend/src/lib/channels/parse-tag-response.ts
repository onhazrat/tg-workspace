export type ParsedTagSuggestions = Record<string, string[]>

function normalizeTagValue(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const value = raw.trim()
  return value.length > 0 ? value : null
}

export function parseTagResponse(responseText: string): ParsedTagSuggestions {
  const parsed = JSON.parse(responseText) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Response must be a JSON object keyed by channel name.")
  }

  const out: ParsedTagSuggestions = {}
  for (const [channelName, rawTags] of Object.entries(parsed)) {
    if (!Array.isArray(rawTags)) {
      throw new Error(`Channel "${channelName}" must map to an array of tags.`)
    }
    const deduped = new Set<string>()
    for (const rawTag of rawTags) {
      const tag = normalizeTagValue(rawTag)
      if (!tag) continue
      deduped.add(tag)
    }
    out[channelName] = [...deduped]
  }
  return out
}
