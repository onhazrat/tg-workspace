import { RefreshCw } from "lucide-react"
import { useState } from "react"
import { TgButton } from "@/components/ui/tg-button"

/** The server's largest Refresh target (`MAX_REFRESH_TARGET`). */
export const MAX_REFRESH_TARGET = 1000

/** A whole number from 1 to the largest target, or `null`. */
export function refreshTargetValue(text: string): number | null {
  if (!/^\s*\d+\s*$/.test(text)) return null
  const value = Number(text)
  return value >= 1 && value <= MAX_REFRESH_TARGET ? value : null
}

/**
 * The Refresh target's control (DRP-02, ADR-045), beside the Priority boost in
 * the bulk bar and the panel: how many new Posts an entry may publish before
 * it is fetched again, set or cleared so it follows the deployment's. Shown to
 * a `DATA_ADMIN` reader only; the caller decides that.
 */
export function DirectoryRefreshTarget({
  onSet,
  current,
  deployment,
}: {
  /** A target, or `null` to clear it. */
  onSet: (value: number | null) => void
  /** The entry's own target now, `null` for none, in the panel; none for a batch. */
  current?: number | null
  /** The deployment's target, which an entry with none follows. */
  deployment?: number | null
}) {
  const [text, setText] = useState("")
  const value = refreshTargetValue(text)
  return (
    <div
      data-testid="directory-refresh-target"
      className="flex items-center gap-1.5 text-xs"
    >
      <RefreshCw size={12} className="text-app-ink/50" />
      <span
        className="text-app-ink/60"
        title="How many new Posts it may publish before the Directory fetches it again, within the deployment's shortest and longest waits"
      >
        Target
        {current != null && (
          <b className="ml-1 font-mono tabular-nums text-app-ink">{current}</b>
        )}
        {current === null && deployment != null && (
          <span className="ml-1 font-mono text-app-ink/40">
            {deployment} (deployment's)
          </span>
        )}
      </span>
      <input
        type="text"
        inputMode="numeric"
        aria-label="Refresh target"
        placeholder="20"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="h-7 w-16 rounded-md border border-app-ink/15 bg-app-muted px-2 font-mono text-xs outline-none focus:border-app-ink/40"
      />
      <TgButton
        type="button"
        variant="secondary"
        size="sm"
        aria-label="Set target"
        disabled={value === null}
        onClick={() => value !== null && onSet(value)}
        className="rounded-full"
      >
        Set
      </TgButton>
      <TgButton
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Clear target"
        title="Follow the deployment's Refresh target"
        disabled={current === null}
        onClick={() => onSet(null)}
        className="rounded-full"
      >
        Clear
      </TgButton>
    </div>
  )
}
