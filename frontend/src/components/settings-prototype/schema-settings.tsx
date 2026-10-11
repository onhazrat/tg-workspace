/**
 * PROTOTYPE (settings redesign), throwaway. Variant B's half of the idea
 * "declare a setting once": the backend serves every settings row as JSON
 * Schema (`backend/scripts/proto_settings_api.py`), and these rows draw
 * themselves from it. Nothing here names a label, default or bound.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, MoreHorizontal, RotateCcw } from "lucide-react"
import type React from "react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { headers } from "@/api/base"
import { ModelCombo } from "@/components/ai/ModelCombo"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { tgFieldClassName } from "@/components/ui/tg-input"
import { TgSegmentedControl } from "@/components/ui/tg-segmented"
import { TgToggle } from "@/components/ui/tg-toggle"
import { useSettings } from "@/contexts/SettingsContext"
import { valuesEqual } from "@/lib/settings/catalog"
import { cn } from "@/lib/utils"
import type { Scope as UiScope } from "./model"
import { DebouncedNumber, ScopeBadge, StartTime } from "./ProtoRow"

export type SchemaScope = "device" | "account" | "deployment"
export type Store = "browser" | "server" | "proto"

export interface JsonProp {
  type?: "boolean" | "integer" | "number" | "string"
  title?: string
  description?: string
  default?: unknown
  enum?: string[]
  minimum?: number
  maximum?: number
}

export interface SchemaRowDef {
  row: string
  title: string
  scope: SchemaScope
  store: Store
  editable: boolean
  schema: { properties: Record<string, JsonProp> }
}

type Values = Record<string, Record<string, { value: unknown; source: string }>>

export interface SchemaField {
  key: string // "row.field"
  row: SchemaRowDef
  name: string
  prop: JsonProp
}

async function proto<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/proto${path}`, { ...init, headers: headers() })
  const body = await res.json()
  if (!res.ok) throw Object.assign(new Error(res.statusText), { body })
  return body as T
}

export function useSettingsSchema() {
  return useQuery({
    queryKey: ["proto-settings-schema"],
    queryFn: () => proto<SchemaRowDef[]>("/settings/schema"),
    staleTime: 60_000,
  })
}

function useProtoValues() {
  return useQuery({
    queryKey: ["proto-settings-values"],
    queryFn: () => proto<Values>("/settings/values"),
  })
}

export function fieldsOf(rows: SchemaRowDef[]): SchemaField[] {
  return rows.flatMap((row) =>
    Object.entries(row.schema.properties).map(([name, prop]) => ({
      key: `${row.row}.${name}`,
      row,
      name,
      prop,
    })),
  )
}

/** VS Code-style layout patterns: `"sync.*"` or `"jobs.embeddingsEnabled"`. */
export function select(
  fields: SchemaField[],
  patterns: string[],
): SchemaField[] {
  return patterns.flatMap((p) =>
    p.endsWith(".*")
      ? fields.filter((f) => f.row.row === p.slice(0, -2))
      : fields.filter((f) => f.key === p),
  )
}

const UI_SCOPE: Record<SchemaScope, UiScope> = {
  device: "browser",
  account: "account",
  deployment: "deployment",
}

/** Value + setter, wherever the row is stored. */
function useFieldValue(
  f: SchemaField,
): [unknown, (v: unknown) => Promise<void>, string | null] {
  const settings = useSettings() as unknown as Record<string, unknown>
  const proto = useProtoValues()
  const qc = useQueryClient()
  if (f.row.store === "proto") {
    const cell = proto.data?.[f.row.row]?.[f.name]
    return [
      cell?.value ?? f.prop.default,
      async (v) => {
        await fetch(`/proto/settings/${f.row.row}`, {
          method: "PUT",
          headers: headers(),
          body: JSON.stringify({ [f.name]: v }),
        })
        await qc.invalidateQueries({ queryKey: ["proto-settings-values"] })
      },
      cell?.source ?? null,
    ]
  }
  const setter = settings[
    `set${f.name.charAt(0).toUpperCase()}${f.name.slice(1)}`
  ] as ((v: unknown) => void) | undefined
  return [settings[f.name], async (v) => setter?.(v), null]
}

export function matchesField(f: SchemaField, q: string): boolean {
  const needle = q.trim().toLowerCase()
  return (
    !needle ||
    `${f.key} ${f.prop.title ?? ""} ${f.prop.description ?? ""}`
      .toLowerCase()
      .includes(needle)
  )
}

export function useIsModified() {
  const settings = useSettings() as unknown as Record<string, unknown>
  const proto = useProtoValues()
  return (f: SchemaField) => {
    const value =
      f.row.store === "proto"
        ? proto.data?.[f.row.row]?.[f.name]?.value
        : settings[f.name]
    return value !== undefined && !valuesEqual(value, f.prop.default)
  }
}

/** The `.env` value that seeds a row's default (variant C). */
export interface Seed {
  key: string
  value: unknown
  configured: boolean
  source: string | null
}

export const SchemaRow: React.FC<{
  field: SchemaField
  highlighted?: boolean
  seed?: Seed
}> = ({ field: f, highlighted, seed }) => {
  const [value, write, source] = useFieldValue(f)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // The deployment can move a default from `.env`; then that is the default.
  const seeded = seed?.configured === true && seed.value !== undefined
  const fallback = seeded ? seed.value : f.prop.default
  const modified = value !== undefined && !valuesEqual(value, fallback)
  const locked = !f.row.editable

  const set = async (v: unknown) => {
    // The server validates every row, including the ones the real API writes.
    const check = await fetch(`/proto/settings/${f.row.row}/validate`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ [f.name]: v }),
    }).then(
      (r) =>
        r.json() as Promise<{ ok: boolean; errors: Record<string, string> }>,
    )
    if (!check.ok) {
      setError(Object.values(check.errors)[0] ?? "Invalid value")
      return
    }
    setError(null)
    await write(v)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  useEffect(() => setError(null), [value])

  return (
    <div
      id={`setting-${f.key}`}
      className={cn(
        "relative scroll-mt-28 border-l-2 border-transparent py-4 pl-4 pr-2",
        modified && "border-l-amber-500/80",
        error && "border-l-red-500",
        highlighted && "bg-amber-500/10",
      )}
    >
      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">
              {f.prop.title ?? f.name}
            </span>
            <ScopeBadge scope={UI_SCOPE[f.row.scope]} locked={locked} />
            {modified ? (
              <span className="text-[11px] text-amber-600 dark:text-amber-400">
                Modified
              </span>
            ) : null}
            {saved ? (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-emerald-600">
                <Check size={11} /> Saved
              </span>
            ) : null}
          </div>
          {f.prop.description ? (
            <p className="mt-1 text-[13px] leading-snug text-app-ink/60">
              {f.prop.description}
            </p>
          ) : null}
          <p className="mt-1 font-mono text-[11px] text-app-ink/35">
            {f.key}
            {source ? ` · ${source}` : ""}
            {seed
              ? seeded
                ? ` · default ${JSON.stringify(seed.value)} from ${seed.key} (${seed.source})`
                : ` · default from ${seed.key}, not set, so ${JSON.stringify(f.prop.default)}`
              : ""}
            {f.row.store === "proto"
              ? " · prototype store, the live app does not read it yet"
              : ""}
          </p>
          {error ? (
            <p className="mt-1 text-[13px] text-red-500">{error}</p>
          ) : null}
        </div>
        {f.name !== "globalStartTimeMode" ? (
          <div
            className={cn(
              "shrink-0",
              locked && "pointer-events-none opacity-50",
            )}
          >
            <JsonControl field={f} value={value} onChange={set} />
          </div>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Options for ${f.prop.title}`}
            className="mt-0.5 rounded p-1 text-app-ink/40 hover:bg-app-ink/5 hover:text-app-ink"
          >
            <MoreHorizontal size={16} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={!modified || locked}
              onClick={() => set(f.prop.default)}
            >
              <RotateCcw size={14} /> Reset to default ({String(f.prop.default)}
              )
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => {
                await navigator.clipboard.writeText(f.key)
                toast.success("Copied setting id")
              }}
            >
              Copy setting id
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {f.name === "globalStartTimeMode" ? (
        <div className={cn("mt-3", locked && "pointer-events-none opacity-50")}>
          <StartTime />
        </div>
      ) : null}
    </div>
  )
}

/** The control a JSON Schema property calls for. */
const JsonControl: React.FC<{
  field: SchemaField
  value: unknown
  onChange: (v: unknown) => void
}> = ({ field: f, value, onChange }) => {
  const { prop } = f
  const label = prop.title ?? f.name
  if (f.name === "selectedModel" || f.name === "translationModel") {
    return (
      <div className="w-72">
        <ModelCombo
          ariaLabel={label}
          value={String(value ?? "")}
          onChange={onChange}
          operatorKey={f.name === "translationModel"}
        />
      </div>
    )
  }
  if (prop.enum) {
    return prop.enum.length <= 4 ? (
      <TgSegmentedControl
        size="dense"
        aria-label={label}
        value={String(value)}
        onChange={(v) => onChange(v)}
        options={prop.enum.map((v) => ({ value: v, label: v }))}
      />
    ) : (
      <select
        aria-label={label}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className={cn(tgFieldClassName, "w-56 text-sm normal-case")}
      >
        {prop.enum.map((v) => (
          <option key={v} value={v} className="bg-app-card text-app-ink">
            {v}
          </option>
        ))}
      </select>
    )
  }
  switch (prop.type) {
    case "boolean":
      return (
        <TgToggle
          checked={Boolean(value)}
          onClick={() => onChange(!value)}
          aria-label={label}
        />
      )
    case "integer":
    case "number":
      return (
        <DebouncedNumber
          value={typeof value === "number" ? value : Number(value) || 0}
          min={prop.minimum}
          max={prop.maximum}
          step={prop.type === "number" ? "any" : undefined}
          label={label}
          onCommit={onChange}
        />
      )
    default:
      return (
        <TextField
          value={String(value ?? "")}
          label={label}
          onCommit={onChange}
        />
      )
  }
}

const TextField: React.FC<{
  value: string
  label: string
  onCommit: (v: string) => void
}> = ({ value, label, onCommit }) => {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      className={cn(
        tgFieldClassName,
        "w-56 text-sm normal-case tracking-normal",
      )}
    />
  )
}
