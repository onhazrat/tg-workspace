/**
 * PROTOTYPE (settings redesign), throwaway. One row style for every plain
 * setting: readable label, scope badge, modified bar, gear menu, and a
 * read-only state with the reason when the account cannot write it.
 */
import {
  Building2,
  Check,
  Copy,
  Link2,
  Lock,
  Monitor,
  MoreHorizontal,
  RotateCcw,
  User,
} from "lucide-react"
import type React from "react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { ModelCombo } from "@/components/ai/ModelCombo"
import { StartTimeSetting } from "@/components/settings/SyncSectionParts"
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
import { useCanManageJobs } from "@/hooks/useJobsStatus"
import { isSettingModified, settingElementId } from "@/lib/settings/catalog"
import type { SettingCatalogEntry } from "@/lib/settings/catalog-types"
import { cn } from "@/lib/utils"
import {
  SCOPE_HINT,
  SCOPE_LABEL,
  type Scope,
  scopeOf,
  sentenceCase,
  settingUrl,
  useCatalogValue,
} from "./model"

const SCOPE_ICON: Record<Scope, React.FC<{ size?: number }>> = {
  browser: Monitor,
  account: User,
  deployment: Building2,
}

export const ScopeBadge: React.FC<{ scope: Scope; locked?: boolean }> = ({
  scope,
  locked,
}) => {
  const Icon = locked ? Lock : SCOPE_ICON[scope]
  return (
    <span
      title={locked ? "Only an Admin can change this." : SCOPE_HINT[scope]}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-none whitespace-nowrap",
        scope === "browser" &&
          "border-sky-500/30 text-sky-700 dark:text-sky-300",
        scope === "account" &&
          "border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
        scope === "deployment" &&
          "border-violet-500/30 text-violet-700 dark:text-violet-300",
      )}
    >
      <Icon size={11} />
      {locked ? "Managed by Admin" : SCOPE_LABEL[scope]}
    </span>
  )
}

/** Whether this account may write a setting of this scope. */
export function useCanWrite(scope: Scope): boolean {
  const isAdmin = useCanManageJobs()
  return scope !== "deployment" || isAdmin
}

export interface ProtoRowProps {
  entry: SettingCatalogEntry
  /** Override the value/setter, e.g. a draft that saves on an explicit Save. */
  value?: unknown
  onChange?: (v: unknown) => void
  highlighted?: boolean
  hideScope?: boolean
  dense?: boolean
}

export const ProtoRow: React.FC<ProtoRowProps> = ({
  entry,
  value: valueOverride,
  onChange: onChangeOverride,
  highlighted,
  hideScope,
  dense,
}) => {
  const [liveValue, liveSet] = useCatalogValue(entry)
  const value = onChangeOverride ? valueOverride : liveValue
  const scope = scopeOf(entry)
  const canWrite = useCanWrite(scope)
  const modified = isSettingModified(entry, value)
  const [saved, setSaved] = useState(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const set = (v: unknown) => {
    if (onChangeOverride) return onChangeOverride(v)
    liveSet(v)
    setSaved(true)
    clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setSaved(false), 1500)
  }

  const wide = entry.id === "globalStartTimeMode"

  return (
    <div
      id={settingElementId(entry.id)}
      data-setting-id={entry.id}
      className={cn(
        "relative scroll-mt-28 border-l-2 border-transparent pl-4 pr-2",
        dense ? "py-3" : "py-4",
        modified && "border-l-amber-500/80",
        highlighted && "bg-amber-500/10",
      )}
    >
      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">
              {sentenceCase(entry.label)}
            </span>
            {!hideScope || !canWrite ? (
              <ScopeBadge scope={scope} locked={!canWrite} />
            ) : null}
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
          <p className="mt-1 text-[13px] leading-snug text-app-ink/60">
            {entry.description}
          </p>
        </div>
        {!wide ? (
          <div
            className={cn(
              "flex shrink-0 items-center gap-1",
              !canWrite && "pointer-events-none opacity-50",
            )}
          >
            <Control entry={entry} value={value} onChange={set} />
          </div>
        ) : null}
        <RowMenu
          entry={entry}
          modified={modified}
          canWrite={canWrite}
          reset={() => set(entry.defaultValue)}
        />
      </div>
      {wide ? (
        <div
          className={cn("mt-3", !canWrite && "pointer-events-none opacity-50")}
        >
          <StartTime />
        </div>
      ) : null}
    </div>
  )
}

const RowMenu: React.FC<{
  entry: SettingCatalogEntry
  modified: boolean
  canWrite: boolean
  reset: () => void
}> = ({ entry, modified, canWrite, reset }) => {
  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text)
    toast.success(`Copied ${what}`)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Options for ${entry.label}`}
        className="mt-0.5 rounded p-1 text-app-ink/40 hover:bg-app-ink/5 hover:text-app-ink"
      >
        <MoreHorizontal size={16} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={!modified || !canWrite} onClick={reset}>
          <RotateCcw size={14} /> Reset to default
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => copy(settingUrl(entry.id), "link")}>
          <Link2 size={14} /> Copy link to setting
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => copy(entry.id, "setting id")}>
          <Copy size={14} /> Copy setting id
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Number fields keep a draft and commit 600ms after the last keystroke. */
const DebouncedNumber: React.FC<{
  value: number
  min?: number
  max?: number
  step?: number | "any"
  label: string
  onCommit: (n: number) => void
}> = ({ value, min, max, step, label, onCommit }) => {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  useEffect(() => {
    const parsed =
      step === "any" ? Number.parseFloat(draft) : Number.parseInt(draft, 10)
    if (Number.isNaN(parsed) || parsed === value) return
    const t = setTimeout(() => onCommit(parsed), 600)
    return () => clearTimeout(t)
  }, [draft, value, step, onCommit])
  return (
    <input
      type="number"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      className={cn(
        tgFieldClassName,
        "w-28 text-right text-sm normal-case tracking-normal",
      )}
    />
  )
}

const Control: React.FC<{
  entry: SettingCatalogEntry
  value: unknown
  onChange: (v: unknown) => void
}> = ({ entry, value, onChange }) => {
  const { control, label } = entry
  if (entry.id === "selectedModel" || entry.id === "translationModel") {
    return (
      <div className="w-72">
        <ModelCombo
          ariaLabel={label}
          value={String(value ?? "")}
          onChange={onChange}
          operatorKey={entry.id === "translationModel"}
        />
      </div>
    )
  }
  switch (control.kind) {
    case "boolean":
      return (
        <TgToggle
          checked={Boolean(value)}
          onClick={() => onChange(!value)}
          aria-label={label}
        />
      )
    case "number":
      return (
        <DebouncedNumber
          value={typeof value === "number" ? value : Number(value) || 0}
          min={control.min}
          max={control.max}
          step={control.step}
          label={label}
          onCommit={onChange}
        />
      )
    case "enum":
      return control.options.length <= 4 ? (
        <TgSegmentedControl
          size="dense"
          aria-label={label}
          value={String(value)}
          onChange={(v) => onChange(v)}
          options={control.options}
        />
      ) : (
        <select
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className={cn(tgFieldClassName, "w-56 text-sm normal-case")}
          aria-label={label}
        >
          {control.options.map((o) => (
            <option
              key={o.value}
              value={o.value}
              className="bg-app-card text-app-ink"
            >
              {o.label}
            </option>
          ))}
        </select>
      )
    default:
      return null
  }
}

const StartTime: React.FC = () => {
  const s = useSettings()
  return (
    <StartTimeSetting
      highlightId={null}
      mode={s.globalStartTimeMode}
      value={s.globalStartTimeValue}
      effectiveStartTime={s.getEffectiveGlobalStartTime()}
      postRetentionDays={s.postRetentionDays}
      onModeChange={s.setGlobalStartTimeMode}
      onValueChange={s.setGlobalStartTimeValue}
    />
  )
}
