/**
 * The Settings page's rows and how a search reads them (SET-02, ADR-032).
 *
 * A row is the registry's `SettingRow`, addressed by its Setting id
 * (`retention.yours.discoverReportDays`). Search is free text plus VS
 * Code-style operators; every word must match somewhere in the row.
 */
import type { SettingRow } from "@/client"

export type Row = SettingRow
export type Scope = Row["scope"]

export const SCOPES: {
  id: Scope
  label: string
  segment: string
  hint: string
}[] = [
  {
    id: "browser",
    label: "This browser",
    segment: "browser",
    hint: "Saved in this browser only",
  },
  {
    id: "account",
    label: "Your account",
    segment: "yours",
    hint: "Follows you to every device",
  },
  {
    id: "deployment",
    label: "Deployment",
    segment: "deployment",
    hint: "Shared by every Account; the Operator changes it",
  },
  {
    id: "env",
    label: ".env",
    segment: "env",
    hint: "Read at startup; change .env and restart",
  },
  {
    id: "code",
    label: "Code",
    segment: "code",
    hint: "A constant in the source; needs a deploy",
  },
]

/** What changing a Configuration row costs; a Setting applies at once. */
const APPLIES_LABEL: Record<string, string> = {
  restart: "Restart to apply",
  rebuild: "Rebuild to apply",
  deploy: "Needs a deploy",
}

export const appliesLabel = (row: Pick<Row, "applies">) =>
  APPLIES_LABEL[row.applies ?? "now"]

export const scopeLabel = (scope: Scope) =>
  SCOPES.find((s) => s.id === scope)?.label ?? scope

export interface Filters {
  scope: Scope | "all"
  modifiedOnly: boolean
  editableOnly: boolean
}

export const OPERATORS = [
  "@modified",
  "@editable",
  "@scope:browser",
  "@scope:yours",
  "@scope:deployment",
  "@scope:env",
  "@scope:code",
  "@restart",
  "@id:",
]

interface ParsedQuery {
  text: string[]
  filters: Partial<Filters> & { restart?: boolean; idPrefix?: string }
}

export function parseQuery(raw: string): ParsedQuery {
  const parsed: ParsedQuery = { text: [], filters: {} }
  for (const word of raw.trim().split(/\s+/).filter(Boolean)) {
    if (word === "@modified") parsed.filters.modifiedOnly = true
    else if (word === "@editable") parsed.filters.editableOnly = true
    else if (word === "@restart") parsed.filters.restart = true
    else if (word.startsWith("@id:")) parsed.filters.idPrefix = word.slice(4)
    else if (word.startsWith("@scope:")) {
      const seg = word.slice(7)
      const scope = SCOPES.find((s) => s.segment === seg || s.id === seg)
      if (scope) parsed.filters.scope = scope.id
    } else parsed.text.push(word.toLowerCase())
  }
  return parsed
}

function haystack(row: Row): string {
  return [
    row.id,
    row.title,
    row.description,
    row.envName ?? "",
    typeof row.value === "object" ? "" : String(row.value),
  ]
    .join(" ")
    .toLowerCase()
}

export function filterRows(rows: Row[], query: string, base: Filters): Row[] {
  const { text, filters } = parseQuery(query)
  const f = { ...base, ...filters }
  const hits = rows.filter((row) => {
    if (f.scope !== "all" && row.scope !== f.scope) return false
    if (f.modifiedOnly && !row.modified) return false
    if (f.editableOnly && !row.canEdit) return false
    if (filters.restart && row.applies !== "restart") return false
    if (filters.idPrefix && !row.id.startsWith(filters.idPrefix)) return false
    const hay = haystack(row)
    return text.every((word) => hay.includes(word))
  })
  if (!text.length) return hits
  // Title and id hits first, the way VS Code ranks a name over a description.
  const rank = (row: Row) =>
    text.every((w) => `${row.title} ${row.id}`.toLowerCase().includes(w))
      ? 0
      : 1
  return [...hits].sort((a, b) => rank(a) - rank(b))
}

export function formatValue(row: Pick<Row, "options">, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "boolean") return value ? "On" : "Off"
  if (typeof value === "object") return JSON.stringify(value)
  const option = row.options?.find((o) => o.value === String(value))
  return option?.label ?? String(value)
}

export function settingLink(id: string): string {
  const url = new URL(window.location.href)
  url.search = ""
  url.searchParams.set("tab", "settings")
  url.searchParams.set("setting", id)
  return url.toString()
}

/** The DOM id a row, panel or topic is scrolled to by. */
export function elementId(id: string) {
  return `setting-${id.replace(/\./g, "-")}`
}

/** Old `?section=` ids, mapped to the topic that holds what they showed. */
const SECTION_TOPICS: Record<string, string> = {
  account: "account",
  appearance: "appearance",
  "channels-sync": "sync",
  sync: "sync",
  "scraping-sync": "sync",
  "setting-groups": "sync",
  ai: "ai",
  "ai-models": "ai",
  "ai-keys": "ai",
  network: "network",
  "network-security": "network",
  proxy: "network",
  tor: "network",
  publishing: "publishing",
  "bot-credentials": "publishing",
  destinations: "publishing",
  retention: "retention",
  users: "operator",
  configuration: "server",
  admin: "operator",
}

/** The topic an old `?section=` link lands on; a topic id lands on itself. */
export function sectionTopic(section: string | undefined): string | undefined {
  if (!section) return undefined
  return SECTION_TOPICS[section] ?? section
}
