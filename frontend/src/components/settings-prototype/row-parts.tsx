/**
 * PROTOTYPE (settings redesign), throwaway. The pieces every generated row
 * shares: the scope badge, the write check, the debounced number field, and
 * the start-time control.
 */
import { Building2, Lock, Monitor, User } from "lucide-react"
import type React from "react"
import { createContext, useContext, useEffect, useState } from "react"
import { StartTimeSetting } from "@/components/settings/SyncSectionParts"
import { tgFieldClassName } from "@/components/ui/tg-input"
import { useSettings } from "@/contexts/SettingsContext"
import { useCanManageJobs } from "@/hooks/useJobsStatus"
import { cn } from "@/lib/utils"
import { SCOPE_HINT, SCOPE_LABEL, type Scope } from "./model"

/**
 * How the shared parts draw themselves. `e` is variant E as it was; `action`
 * and `compact` borrow the Action and Channels tabs' primitives (variants I-K).
 */
export type Look = "e" | "action" | "compact"
export const LookContext = createContext<Look>("e")
export const useLook = () => useContext(LookContext)

/** The field class per look: E keeps the settings field, I-K the toolbar's. */
export function useFieldClass(): string {
  return useLook() === "e"
    ? tgFieldClassName
    : "h-9 rounded-lg border border-app-ink/10 bg-app-muted/50 px-3 text-xs outline-none focus:ring-2 focus:ring-app-ink/20"
}

/** `channelName` or `as_written` → `Channel name`, `As written`. */
export function humanizeValue(v: string): string {
  const words = v
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

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
  const look = useLook()
  if (look !== "e")
    // The Channels card's meta chip: neutral, the icon carries the scope.
    return (
      <span
        title={locked ? "Only an Admin can change this." : SCOPE_HINT[scope]}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-app-muted/30 px-2 py-0.5 text-[10px] font-bold text-app-ink/60"
      >
        <Icon size={10} />
        {locked ? "Admin only" : SCOPE_LABEL[scope]}
      </span>
    )
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

/** Number fields keep a draft and commit 600ms after the last keystroke. */
export const DebouncedNumber: React.FC<{
  value: number
  min?: number
  max?: number
  step?: number | "any"
  label: string
  onCommit: (n: number) => void
}> = ({ value, min, max, step, label, onCommit }) => {
  const fieldClass = useFieldClass()
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
        fieldClass,
        "w-28 text-right text-sm normal-case tracking-normal",
      )}
    />
  )
}

export const StartTime: React.FC = () => {
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
