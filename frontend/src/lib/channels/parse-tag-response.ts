export type ParsedTagSuggestions = Record<string, string[]>

function normalizeTagValue(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const value = raw.trim()
  return value.length > 0 ? value : null
}

export function extractTagResponseJson(responseText: string): string {
  const trimmed = responseText.trim()
  if (!trimmed) {
    throw new Error("Response text cannot be empty.")
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()

  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1)

  return trimmed
}

export function parseTagResponse(responseText: string): ParsedTagSuggestions {
  const parsed = JSON.parse(extractTagResponseJson(responseText)) as unknown
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
