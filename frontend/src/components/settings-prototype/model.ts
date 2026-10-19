/**
 * PROTOTYPE, throw away. One list of every setting, `.env` value and code
 * constant, addressed by nested ids (`retention.yours.discoverReportDays`).
 *
 * Server rows come from `backend/scripts/proto_settings_registry_api.py` over
 * `/proto`; browser rows are generated here from `appSettingsSpec`. Labels,
 * descriptions and enum options are borrowed from `SETTINGS_CATALOG` where a
 * row's field matches a catalog id. Server writes land in the prototype's own
 * table, never in the app; browser writes are real (this origin only).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { useMemo } from "react"
import { headers } from "@/api/base"
import { useTheme } from "@/components/theme-provider"
import { LANGUAGES } from "@/constants"
import { useSettings } from "@/contexts/SettingsContext"
import { SETTINGS_CATALOG } from "@/lib/settings/catalog"
import type { SettingCatalogEntry } from "@/lib/settings/catalog-types"
import { NETWORK_SETTINGS_DEFAULTS } from "@/lib/settings/network"
import { appSettingsSpec } from "@/lib/settings/schema"

export type Scope = "browser" | "account" | "deployment" | "env" | "code"

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
    hint: "Shared by every account; Admins change it",
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

export interface Row {
  id: string
  title: string
  description: string
  topic: string
  scope: Scope
  type: "boolean" | "integer" | "number" | "string" | "json" | "enum"
  value: unknown
  default: unknown
  modified: boolean
  canEdit: boolean
  lockReason: string | null
  applies: string
  storage: string
  sensitive?: boolean
  envName?: string
  sourceRef?: string
  expr?: string
  options?: { value: string; label: string }[]
  min?: number
  max?: number
  overridden?: boolean
}

export interface Topic {
  id: string
  title: string
}

interface Registry {
  user: {
    id: string
    email: string
    fullName: string | null
    permissions: string[]
    isAdmin: boolean
  }
  topics: Topic[]
  rows: Row[]
}

const workspaceRoute = getRouteApi("/_tg/")

/** Which browser keys belong to which topic; the rest are Appearance. */
const BROWSER_TOPIC: [RegExp, string][] = [
  [/^(aiLanguage|selectedModel|aiTemperature|embeddings)/, "ai"],
  [/^discover/, "directory"],
]

const BROWSER_NAMES: Record<string, string> = {
  showChannelBio: "channelCard.showBio",
  showChannelSubscribers: "channelCard.showSubscribers",
  showChannelTelegramChatId: "channelCard.showChatId",
  showChannelPhotos: "channelCard.showPhotos",
  showChannelVideos: "channelCard.showVideos",
  showChannelFiles: "channelCard.showFiles",
  showChannelLinks: "channelCard.showLinks",
  showChannelStartId: "channelCard.showStartId",
  channelCardZoom: "channelCard.zoom",
  selectedModel: "model",
  aiLanguage: "language",
  aiTemperature: "temperature",
}

function sentence(label: string): string {
  return label
    .split(" ")
    .map((word, i) =>
      i === 0 || /^[A-Z0-9]{2,}$/.test(word) ? word : word.toLowerCase(),
    )
    .join(" ")
}

function catalogFor(field: string): SettingCatalogEntry | undefined {
  return SETTINGS_CATALOG.find((entry) => entry.id === field)
}

const opts = (pairs: [string, string][]) =>
  pairs.map(([value, label]) => ({ value, label }))

/** Enums the catalog does not describe; their types say what they allow. */
const ENUMS: Record<string, { value: string; label: string }[]> = {
  citationStyle: opts([
    ["asWritten", "As written"],
    ["channelName", "Channel name"],
    ["numbered", "Numbered"],
  ]),
  summaryTextSize: opts([
    ["S", "Small"],
    ["M", "Medium"],
    ["L", "Large"],
  ]),
  torMode: opts([
    ["auto", "Automatic"],
    ["custom", "Custom pool"],
  ]),
  torRotationStrategy: opts([
    ["sequential", "In order"],
    ["random", "Random"],
  ]),
  globalStartTimeMode: opts([
    ["retention", "Retention window"],
    ["relative", "Relative"],
    ["absolute", "Absolute date"],
  ]),
  translationTargetLanguage: LANGUAGES.map((l) => ({ value: l, label: l })),
}

function enrich(row: Row, field: string): Row {
  const entry = catalogFor(field)
  if (!entry) {
    return ENUMS[field] && row.canEdit
      ? { ...row, type: "enum", options: ENUMS[field] }
      : row
  }
  const control = entry.control
  return {
    ...row,
    title: sentence(entry.label),
    description: entry.description || row.description,
    ...(control.kind === "enum"
      ? { type: "enum" as const, options: control.options }
      : {}),
    ...(control.kind === "number"
      ? { min: control.min, max: control.max }
      : {}),
  }
}

function browserRows(values: Record<string, unknown>, theme: string): Row[] {
  const rows: Row[] = [
    {
      id: "appearance.browser.theme",
      title: "Color theme",
      description: "Light, dark, or follow the system.",
      topic: "appearance",
      scope: "browser",
      type: "enum",
      options: [
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
        { value: "system", label: "System" },
      ],
      value: theme,
      default: "dark",
      modified: theme !== "dark",
      canEdit: true,
      lockReason: null,
      applies: "now",
      storage: "localStorage theme",
    },
  ]
  for (const [key, spec] of Object.entries(appSettingsSpec)) {
    const s = spec as { section?: string; defaultValue: unknown }
    if (s.section || key === "embeddingsPaused") continue
    const topic =
      BROWSER_TOPIC.find(([re]) => re.test(key))?.[1] ?? "appearance"
    const value = values[key]
    const type =
      typeof s.defaultValue === "boolean"
        ? "boolean"
        : typeof s.defaultValue === "number"
          ? "number"
          : typeof s.defaultValue === "string"
            ? "string"
            : "json"
    rows.push(
      enrich(
        {
          id: `${topic}.browser.${BROWSER_NAMES[key] ?? key}`,
          title: sentence(
            key
              .replace(/(?<=[a-z0-9])(?=[A-Z])/g, " ")
              .replace(/^./, (c) => c.toUpperCase()),
          ),
          description: "",
          topic,
          scope: "browser",
          type,
          value,
          default: s.defaultValue,
          modified: JSON.stringify(value) !== JSON.stringify(s.defaultValue),
          canEdit: type !== "json",
          lockReason: type === "json" ? "Edited where it is used" : null,
          applies: "now",
          storage: `localStorage ${key}`,
        },
        key,
      ),
    )
  }
  return rows
}

/** The registry for this account, browser rows included. */
export function useRegistry() {
  const { as } = workspaceRoute.useSearch()
  const settings = useSettings() as unknown as Record<string, unknown>
  const { theme, setTheme } = useTheme()
  const client = useQueryClient()
  const key = ["proto-settings", as ?? "self"]
  const query = useQuery({
    queryKey: key,
    queryFn: async (): Promise<Registry> => {
      const response = await fetch(`/proto/settings${as ? `?as=${as}` : ""}`, {
        headers: headers(),
      })
      if (!response.ok) throw new Error(await response.text())
      return response.json()
    },
    staleTime: 60_000,
  })

  const save = useMutation({
    mutationFn: async ({
      row,
      value,
      reset,
    }: {
      row: Row
      value?: unknown
      reset?: boolean
    }) => {
      if (row.scope === "browser") {
        const next = reset ? row.default : value
        if (row.id === "appearance.browser.theme") {
          setTheme(next as "light" | "dark" | "system")
          return
        }
        const field = row.storage.replace("localStorage ", "")
        const setter = settings[`set${field[0].toUpperCase()}${field.slice(1)}`]
        if (typeof setter === "function") setter(next)
        return
      }
      const response = await fetch(
        `/proto/settings/${encodeURIComponent(row.id)}${as ? `?as=${as}` : ""}`,
        {
          method: "PUT",
          headers: headers(),
          body: JSON.stringify(reset ? { reset: true } : { value }),
        },
      )
      if (!response.ok) throw new Error((await response.json()).detail)
    },
    // The registry takes seconds to rebuild over the tunnel; show the change now.
    onMutate: ({ row, value, reset }) => {
      if (row.scope === "browser") return
      const next = reset ? row.default : value
      client.setQueryData<Registry>(
        key,
        (old) =>
          old && {
            ...old,
            rows: old.rows.map((r) =>
              r.id === row.id
                ? {
                    ...r,
                    value: next,
                    overridden: !reset,
                    modified:
                      JSON.stringify(next) !== JSON.stringify(r.default),
                  }
                : r,
            ),
          },
      )
    },
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  })

  const rows = useMemo(() => {
    const server = (query.data?.rows ?? []).map((raw) => {
      let row = raw
      const field = row.storage.split(".").pop() ?? ""
      // The server has no default for some fields (Tor, publishing): the
      // browser's copy is the only one. The drift a single registry removes.
      if (row.default == null && row.scope !== "env" && row.scope !== "code") {
        const fallback =
          (appSettingsSpec as Record<string, { defaultValue: unknown }>)[field]
            ?.defaultValue ??
          (NETWORK_SETTINGS_DEFAULTS as unknown as Record<string, unknown>)[
            field
          ]
        if (fallback !== undefined) {
          row = {
            ...row,
            default: fallback,
            modified: JSON.stringify(row.value) !== JSON.stringify(fallback),
          }
        }
      }
      if (row.default == null && row.scope !== "env" && row.scope !== "code")
        row = { ...row, modified: false }
      return enrich(row, field)
    })
    return [...browserRows(settings, theme), ...server]
  }, [query.data, settings, theme])

  return {
    rows,
    topics: query.data?.topics ?? [],
    user: query.data?.user,
    isLoading: query.isLoading,
    error: query.error,
    save: (row: Row, value: unknown) => save.mutateAsync({ row, value }),
    reset: (row: Row) => save.mutateAsync({ row, reset: true }),
    asMember: as === "member",
  }
}

// --- Search -----------------------------------------------------------------

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

/** Free text plus VS Code-style operators. Every word must match somewhere. */
export function parseQuery(raw: string) {
  const words = raw.trim().split(/\s+/).filter(Boolean)
  const filters: Partial<Filters> & { restart?: boolean; idPrefix?: string } =
    {}
  const text: string[] = []
  for (const word of words) {
    if (word === "@modified") filters.modifiedOnly = true
    else if (word === "@editable") filters.editableOnly = true
    else if (word === "@restart") filters.restart = true
    else if (word.startsWith("@id:")) filters.idPrefix = word.slice(4)
    else if (word.startsWith("@scope:")) {
      const seg = word.slice(7)
      const scope = SCOPES.find((s) => s.segment === seg || s.id === seg)
      if (scope) filters.scope = scope.id
    } else text.push(word.toLowerCase())
  }
  return { text, filters }
}

function haystack(row: Row): string {
  return [
    row.id,
    row.title,
    row.description,
    row.storage,
    row.envName,
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
  // Title and id hits first, the way VS Code ranks a name match over a
  // description match.
  const rank = (row: Row) =>
    text.every((w) => `${row.title} ${row.id}`.toLowerCase().includes(w))
      ? 0
      : 1
  return [...hits].sort((a, b) => rank(a) - rank(b))
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "boolean") return value ? "On" : "Off"
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

/** `retention.yours.discoverReportDays` → its sub-heading and leaf. */
export function idParts(id: string) {
  const [topic, segment, ...rest] = id.split(".")
  return { topic, segment, leaf: rest.join(".") }
}

export function settingLink(id: string): string {
  const url = new URL(window.location.href)
  url.searchParams.set("tab", "settings")
  url.searchParams.set("setting", id)
  return url.toString()
}
