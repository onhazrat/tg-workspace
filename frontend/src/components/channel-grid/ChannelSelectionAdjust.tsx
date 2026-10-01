import { Eye, EyeOff } from "lucide-react"
import { SelectionAdjust } from "@/components/SelectionAdjust"
import {
  type ActionLimit,
  applyRegions,
  regionsOf,
  SELECTION_EDITS,
} from "@/lib/channels/selection-regions"
import { cn } from "@/lib/utils"

type LimitProps = {
  selection: ReadonlySet<string>
  shown: string[]
  limit: ActionLimit
  onLimitChange: (limit: ActionLimit) => void
}

/**
 * Row 2's indicator: shown only while the filters hide part of the selection,
 * blue while the actions reach the shown part alone, amber while they reach
 * Channels off screen. A click switches the limit.
 */
export function ActionLimitIndicator({
  selection,
  shown,
  limit,
  onLimitChange,
}: LimitProps) {
  const r = regionsOf(selection, shown)
  if (r.hidden.length === 0) return null
  const onShown = limit === "shown"
  return (
    <button
      type="button"
      data-testid="action-limit-indicator"
      aria-pressed={onShown}
      onClick={() => onLimitChange(onShown ? "all" : "shown")}
      title={
        onShown
          ? `Actions, Trim and the sort rank reach only the ${r.both.length} shown. Click to include the ${r.hidden.length} hidden.`
          : `Actions reach all ${selection.size}, ${r.hidden.length} of them hidden by filters. Click to act on the shown only.`
      }
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[10px] font-semibold",
        onShown
          ? "border-sky-500/50 bg-sky-500/10 text-sky-600"
          : "border-amber-500/50 bg-amber-500/10 text-amber-700",
      )}
    >
      {onShown ? (
        <Eye size={11} aria-hidden />
      ) : (
        <EyeOff size={11} aria-hidden />
      )}
      {onShown
        ? `acting on ${r.both.length} shown`
        : `${r.hidden.length} hidden by filters`}
    </button>
  )
}

/**
 * Adjust selection (CTB-04) over Channels: the shared Venn counted in the
 * browser, every preset offered, and the action limit under Apply because it
 * answers the same question.
 */
export function ChannelSelectionAdjust({
  selection,
  shown,
  onApply,
  limit,
  onLimitChange,
}: LimitProps & { onApply: (next: Set<string>) => void }) {
  const r = regionsOf(selection, shown)
  const counts = {
    hidden: r.hidden.length,
    both: r.both.length,
    fresh: r.fresh.length,
  }

  return (
    <SelectionAdjust
      counts={counts}
      edits={SELECTION_EDITS}
      onApply={(keep) => onApply(applyRegions(selection, shown, keep))}
    >
      <div className="mt-3 border-t border-app-ink/10 pt-3">
        <div className="mb-1.5 text-[10px] font-semibold text-app-ink/60">
          Actions, trim and sort rank apply to
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-app-ink/10 p-0.5">
          {(
            [
              ["shown", "Shown", `${counts.both} selected and shown`, Eye],
              ["all", "All", `all ${selection.size} selected`, EyeOff],
            ] as const
          ).map(([value, text, hint, Icon]) => (
            <button
              key={value}
              type="button"
              aria-pressed={limit === value}
              title={hint}
              onClick={() => onLimitChange(value)}
              className={cn(
                "flex items-center justify-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-bold",
                limit === value
                  ? "bg-app-ink text-app-bg"
                  : "text-app-ink/70 hover:bg-app-ink/5",
              )}
            >
              <Icon size={12} aria-hidden />
              {text}
            </button>
          ))}
        </div>
      </div>
    </SelectionAdjust>
  )
}
