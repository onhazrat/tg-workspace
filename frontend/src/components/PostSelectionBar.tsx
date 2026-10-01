import { X } from "lucide-react"
import type { SelectionChip } from "@/lib/posts/post-selection"
import { cn } from "@/lib/utils"
import { pillClass } from "./PostFilterParts"

export interface PostSelectionBarProps {
  /** Selected Posts in the window, filters aside. */
  selected: number
  /** Every Post in the window; unknown while it loads. */
  total: number | undefined
  chips: SelectionChip[]
  /** A meaning search is on, so Select all picks its results one by one. */
  ranked: boolean
  onSelectAll: () => void
  onDeselectAll: () => void
  onRemoveChip: (chip: SelectionChip) => void
}

/**
 * The Post selection (PTR-05): what Summarize, Chat, Tag run and Discovery
 * cover, apart from what the feed shows. Select all and Deselect all take
 * what the filter shows; the chips are the steps, last one wins.
 */
export function PostSelectionBar({
  selected,
  total,
  chips,
  ranked,
  onSelectAll,
  onDeselectAll,
  onRemoveChip,
}: PostSelectionBarProps) {
  const over = ranked ? "these search results" : "what the filter shows"
  return (
    <section
      aria-label="Post selection"
      className="flex flex-wrap items-center gap-2 text-xs text-app-ink/60"
    >
      <span className="font-medium text-app-ink">
        {selected.toLocaleString()} selected
        {total !== undefined && ` of ${total.toLocaleString()} in window`}
      </span>
      <button
        type="button"
        className={pillClass(false)}
        title={`Select ${over}`}
        onClick={onSelectAll}
      >
        Select all
      </button>
      <button
        type="button"
        className={pillClass(false)}
        title={`Deselect ${over}`}
        onClick={onDeselectAll}
      >
        Deselect all
      </button>
      <ol className="flex flex-wrap items-center gap-1.5" aria-label="Steps">
        {chips.map((chip, i) => (
          <li
            key={chip.start}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
              chip.select
                ? "border-blue-500/30 bg-blue-500/10 text-app-ink"
                : "border-app-ink/15 bg-app-muted text-app-ink/70",
            )}
          >
            {i > 0 && <span className="sr-only">then </span>}
            {chip.label}
            <button
              type="button"
              aria-label={`Remove ${chip.label}`}
              onClick={() => onRemoveChip(chip)}
              className="rounded-full p-0.5 hover:bg-app-ink/10"
            >
              <X size={10} />
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
