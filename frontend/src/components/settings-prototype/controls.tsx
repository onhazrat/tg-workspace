/**
 * PROTOTYPE, throw away. The one control per row type, drawn with the
 * workspace's existing primitives (TgToggle, TgSegmentedControl, the Posts
 * filter's compact input), and the row menu. Both variants use these; they
 * differ in layout, not in controls.
 */
import {
  Archive,
  Compass,
  Cpu,
  Database,
  Eye,
  Gauge,
  Globe,
  Image,
  KeyRound,
  Layout,
  Lock,
  type LucideIcon,
  Mail,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Send,
  Server,
  Timer,
  UserRound,
  Users,
} from "lucide-react"
import type React from "react"
import { useEffect, useState } from "react"
import { ACTION_SWITCH_OPTION_CLASS } from "@/components/action/ActionRow"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TgSegmentedControl } from "@/components/ui/tg-segmented"
import { TgToggle } from "@/components/ui/tg-toggle"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tg-tooltip"
import { formatValue, type Row, settingLink } from "./model"

const inputClass =
  "h-8 rounded-lg border border-app-ink/15 bg-app-muted px-2 font-mono text-xs focus:border-app-ink/40 focus:outline-none"

function DraftInput({
  row,
  onCommit,
}: {
  row: Row
  onCommit: (value: unknown) => void
}) {
  const numeric = row.type === "integer" || row.type === "number"
  const [draft, setDraft] = useState(String(row.value ?? ""))
  useEffect(() => setDraft(String(row.value ?? "")), [row.value])
  const parsed = numeric ? Number(draft) : draft
  const bad =
    numeric &&
    (draft.trim() === "" ||
      Number.isNaN(parsed) ||
      (row.type === "integer" && !Number.isInteger(parsed)) ||
      (row.min != null && (parsed as number) < row.min) ||
      (row.max != null && (parsed as number) > row.max))
  const commit = () => {
    if (!bad && String(parsed) !== String(row.value ?? "")) onCommit(parsed)
  }
  return (
    <input
      aria-label={row.title}
      aria-invalid={bad}
      inputMode={numeric ? "decimal" : undefined}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === "Enter") commit()
        if (e.key === "Escape") setDraft(String(row.value ?? ""))
      }}
      title={
        bad && row.min != null
          ? `Between ${row.min} and ${row.max ?? "∞"}`
          : undefined
      }
      className={`${inputClass} ${numeric ? "w-28 text-right" : "w-full max-w-sm"} ${bad ? "border-red-500/60" : ""}`}
    />
  )
}

export function SettingControl({
  row,
  onChange,
}: {
  row: Row
  onChange: (value: unknown) => void
}) {
  if (!row.canEdit) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-lg bg-app-ink/5 px-2 py-1 font-mono text-xs text-app-ink/70">
            <Lock size={11} className="shrink-0 opacity-60" />
            <span className="truncate">{formatValue(row.value)}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{row.lockReason}</p>
        </TooltipContent>
      </Tooltip>
    )
  }
  if (row.type === "boolean") {
    return (
      <TgToggle
        aria-label={row.title}
        checked={Boolean(row.value)}
        onClick={() => onChange(!row.value)}
      />
    )
  }
  if (row.type === "enum" && row.options) {
    if (row.options.length <= 4) {
      return (
        <TgSegmentedControl
          aria-label={row.title}
          size="sm"
          optionClassName={ACTION_SWITCH_OPTION_CLASS}
          options={row.options}
          value={String(row.value)}
          onChange={onChange}
        />
      )
    }
    return (
      <select
        aria-label={row.title}
        value={String(row.value)}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} max-w-xs`}
      >
        {row.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }
  return <DraftInput row={row} onCommit={onChange} />
}

export function RowMenu({
  row,
  onReset,
  trigger,
}: {
  row: Row
  onReset: () => void
  trigger?: React.ReactNode
}) {
  const copy = (text: string) => void navigator.clipboard?.writeText(text)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            aria-label={`More for ${row.title}`}
            className="flex size-7 items-center justify-center rounded-md text-app-ink/50 hover:bg-app-ink/5 hover:text-app-ink"
          >
            <MoreHorizontal size={14} />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="text-xs">
        <DropdownMenuItem
          disabled={!row.modified || !row.canEdit}
          onSelect={onReset}
        >
          <RotateCcw size={12} /> Reset to {formatValue(row.default)}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => copy(row.id)}>
          Copy setting id
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => copy(settingLink(row.id))}>
          Copy link to setting
        </DropdownMenuItem>
        {row.envName && (
          <DropdownMenuItem
            onSelect={() => copy(`${row.envName}=${formatValue(row.value)}`)}
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

/** Wraps each matched word in `<mark>`, case-insensitively. */
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

/** Where a value comes from and when a change takes effect. */
export function Provenance({ row }: { row: Row }) {
  return (
    <span className="font-mono text-[10px] text-app-ink/40">
      {row.storage}
      {row.applies !== "now" && ` · applies: ${row.applies}`}
      {row.overridden && " · prototype override"}
    </span>
  )
}

export const TOPIC_ICONS: Record<string, LucideIcon> = {
  account: UserRound,
  appearance: Layout,
  sync: RefreshCw,
  ai: Cpu,
  publishing: Send,
  network: Globe,
  retention: Archive,
  directory: Compass,
  reach: Eye,
  media: Image,
  jobs: Timer,
  quota: Gauge,
  access: KeyRound,
  email: Mail,
  database: Database,
  server: Server,
  admin: Users,
}
