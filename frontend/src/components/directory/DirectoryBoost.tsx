import { ArrowUpDown } from "lucide-react"
import { useState } from "react"
import { TgButton } from "@/components/ui/tg-button"

export type BoostMode = "set" | "add"

/** The server's range either way (`MAX_PRIORITY_BOOST`). */
export const MAX_BOOST = 1_000_000_000

/** A whole number within the range, or `null`. */
export function boostValue(text: string): number | null {
  if (!/^\s*[+-]?\d+\s*$/.test(text)) return null
  const value = Number(text)
  return Math.abs(value) <= MAX_BOOST ? value : null
}

/**
 * The Priority boost's control (DPF), for the bulk bar and the panel: a whole
 * number, and Set or Add. Positive fetches sooner. Shown to a `DATA_ADMIN`
 * reader only; the caller decides that.
 */
export function DirectoryBoost({
  onBoost,
  current,
  effective,
}: {
  onBoost: (mode: BoostMode, value: number) => void
  /** The entry's boost now, in the panel; none for a batch. */
  current?: number
  /** Its effective priority now, in the panel. */
  effective?: number
}) {
  const [text, setText] = useState("")
  const value = boostValue(text)
  return (
    <div
      data-testid="directory-boost"
      className="flex items-center gap-1.5 text-xs"
    >
      <ArrowUpDown size={12} className="text-app-ink/50" />
      <span
        className="text-app-ink/60"
        title="Positive fetches sooner, negative later, among the entries waiting beside it"
      >
        Boost
        {current !== undefined && (
          <b className="ml-1 font-mono tabular-nums text-app-ink">{current}</b>
        )}
        {effective !== undefined && (
          <span className="ml-1 font-mono text-[10px] text-app-ink/40">
            (effective {effective})
          </span>
        )}
      </span>
      <input
        type="text"
        inputMode="numeric"
        aria-label="Priority boost"
        placeholder="+1"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="h-7 w-20 rounded-md border border-app-ink/15 bg-app-muted px-2 font-mono text-xs outline-none focus:border-app-ink/40"
      />
      {(["set", "add"] as const).map((mode) => (
        <TgButton
          key={mode}
          type="button"
          variant="secondary"
          size="sm"
          disabled={value === null}
          onClick={() => value !== null && onBoost(mode, value)}
          className="rounded-full"
        >
          {mode === "set" ? "Set" : "Add"}
        </TgButton>
      ))}
    </div>
  )
}
