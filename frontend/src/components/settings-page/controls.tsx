/**
 * One control per row type, drawn with the workspace's existing primitives
 * (SET-02): `BarToggle` for on / off, inline segments for a few choices, a
 * `Pill` with `Options` for many, the popover input for text and numbers.
 * Plus the row menu and search highlighting.
 */
import { Lock, RotateCcw } from "lucide-react"
import type React from "react"
import { useEffect, useState } from "react"
import { BarToggle } from "@/components/channel-grid/ChannelBarControls"
import { Options, Pill } from "@/components/PostFilterParts"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TgInlineChoice } from "@/components/ui/tg-inline-segments"
import { formatValue, type Row, settingLink } from "./model"

/** The `BarSearch` input, without the autofocus. */
const fieldClass =
  "h-8 rounded-lg border bg-app-muted px-2.5 text-xs outline-none disabled:opacity-50"

/** Why a number draft cannot be sent, or `null` when it can. */
export function numberRefusal(row: Row, draft: string): string | null {
  const n = Number(draft)
  if (draft.trim() === "" || Number.isNaN(n)) return "Enter a number"
  if (row.type === "integer" && !Number.isInteger(n)) return "A whole number"
  if (row.min != null && n < row.min) return `At least ${row.min}`
  if (row.max != null && n > row.max) return `At most ${row.max}`
  return null
}

/** A JSON row's draft: JSON when it parses, the raw text when it does not. */
function parseDraft(row: Row, draft: string): unknown {
  if (row.type === "integer" || row.type === "number") return Number(draft)
  if (row.type !== "json") return draft
  if (draft.trim() === "") return null
  try {
    return JSON.parse(draft)
  } catch {
    return draft
  }
}

const draftOf = (row: Row) =>
  row.value == null
    ? ""
    : typeof row.value === "object"
      ? JSON.stringify(row.value)
      : String(row.value)

/** A text or number field that saves on Enter or blur; Escape undoes. */
export function DraftField({
  row,
  error,
  onCommit,
  onCancel,
}: {
  row: Row
  /** The server's refusal of the last commit; the draft is kept while set. */
  error: string | null
  onCommit: (value: unknown) => void
  onCancel: () => void
}) {
  const saved = draftOf(row)
  const [draft, setDraft] = useState(saved)
  useEffect(() => setDraft(saved), [saved])
  const numeric = row.type === "integer" || row.type === "number"
  const refusal = numeric ? numberRefusal(row, draft) : null
  const commit = () => {
    if (!refusal && draft !== saved) onCommit(parseDraft(row, draft))
  }
  const bad = Boolean(refusal) || Boolean(error)
  return (
    <span className="inline-flex flex-col gap-1">
      <input
        type="text"
        aria-label={row.title}
        aria-invalid={bad}
        inputMode={numeric ? "decimal" : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === "Enter") commit()
          if (e.key === "Escape") {
            setDraft(saved)
            onCancel()
          }
        }}
        className={`${fieldClass} ${numeric ? "w-28 text-right tabular-nums" : "w-80 max-w-full"} ${
          bad
            ? "border-red-500/70"
            : "border-app-ink/15 focus:border-app-ink/40"
        }`}
      />
      {refusal && draft !== saved && (
        <span className="text-[11px] text-red-500">{refusal}</span>
      )}
    </span>
  )
}

export function Control({
  row,
  error,
  onSave,
  onCancel,
}: {
  row: Row
  error: string | null
  onSave: (value: unknown) => void
  onCancel: () => void
}) {
  if (!row.canEdit) {
    return (
      <span
        title={row.lockReason ?? undefined}
        className="inline-flex max-w-full items-center gap-1.5 overflow-hidden rounded-lg bg-app-ink/5 px-2.5 py-1.5 font-mono text-[11px] text-app-ink/70"
      >
        <Lock size={11} className="shrink-0 opacity-60" />
        <span className="truncate">{formatValue(row, row.value)}</span>
        <span className="font-sans text-app-ink/50">· {row.lockReason}</span>
      </span>
    )
  }
  if (row.type === "boolean") {
    return (
      <BarToggle
        on={Boolean(row.value)}
        onClick={() => onSave(!row.value)}
        label={row.value ? "On" : "Off"}
        title={row.title}
      />
    )
  }
  const options = row.options ?? []
  if (row.type === "enum" && options.length <= 4) {
    return (
      <TgInlineChoice
        aria-label={row.title}
        options={options}
        value={String(row.value)}
        onChange={onSave}
      />
    )
  }
  if (row.type === "enum") {
    return (
      <Pill
        label={row.title}
        value={formatValue(row, row.value)}
        active={row.modified}
      >
        <Options
          options={options}
          value={String(row.value)}
          onChange={onSave}
        />
      </Pill>
    )
  }
  return (
    <DraftField row={row} error={error} onCommit={onSave} onCancel={onCancel} />
  )
}

export function RowMenu({
  row,
  onReset,
  trigger,
}: {
  row: Row
  onReset: () => void
  trigger: React.ReactNode
}) {
  const copy = (text: string) => void navigator.clipboard?.writeText(text)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="text-xs">
        <DropdownMenuItem
          disabled={!row.modified || !row.canEdit}
          onSelect={onReset}
        >
          <RotateCcw size={12} /> Reset to {formatValue(row, row.default)}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => copy(row.id)}>
          Copy Setting id
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => copy(settingLink(row.id))}>
          Copy link
        </DropdownMenuItem>
        {row.envName && (
          <DropdownMenuItem
            onSelect={() =>
              copy(`${row.envName}=${formatValue(row, row.value)}`)
            }
          >
            Copy .env line
          </DropdownMenuItem>
        )}
        {row.sourceRef && (
          <DropdownMenuItem onSelect={() => copy(row.sourceRef ?? "")}>
            Copy {row.sourceRef}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Wraps each searched word in `<mark>`, case-insensitively. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const words = query
    .split(/\s+/)
    .filter((w) => w && !w.startsWith("@"))
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  if (!words.length) return <>{text}</>
  const parts = text.split(new RegExp(`(${words.join("|")})`, "gi"))
  return (
    <>
      {parts.map((part, i) =>
        i % 2 ? (
          <mark key={i} className="rounded-sm bg-amber-300/50 text-inherit">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  )
}
