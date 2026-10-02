import { FileDown, Link2, X } from "lucide-react"
import {
  type RegionCounts,
  type Regions,
  SELECTION_EDITS,
} from "@/lib/channels/selection-regions"
import { isExpressible, type SelectionChip } from "@/lib/posts/post-selection"
import { cn } from "@/lib/utils"
import { BarToggle } from "./channel-grid/ChannelBarControls"
import { pillClass } from "./PostFilterParts"
import { SelectionAdjust } from "./SelectionAdjust"

// A rule sets Posts, it cannot flip each one (PTR-06).
const POST_EDITS = SELECTION_EDITS.filter((edit) => isExpressible(edit.regions))

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
  /** The Venn's regions; `undefined` over a meaning search, which no rule repeats. */
  regions: RegionCounts | undefined
  /** A Venn picture, which the tab records as rules over the filter. */
  onAdjust: (keep: Regions) => void
  selectedFirst: boolean
  onSelectedFirstChange: (on: boolean) => void
  onCopyLinks: () => void
  onExportMarkdown: () => void
}

/**
 * The Post selection (PTR-05): what Summarize, Chat, Tag run and Discovery
 * cover, apart from what the feed shows. Select all and Deselect all take
 * what the filter shows; the chips are the steps, last one wins. Its tools
 * (PTR-06): the Channels tab's Adjust selection Venn, without the action
 * limit and the one picture rules cannot draw; Selected first; and Copy
 * links and Export Markdown over the selected Posts the filter shows.
 */
export function PostSelectionBar({
  selected,
  total,
  chips,
  ranked,
  onSelectAll,
  onDeselectAll,
  onRemoveChip,
  regions,
  onAdjust,
  selectedFirst,
  onSelectedFirstChange,
  onCopyLinks,
  onExportMarkdown,
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
      <SelectionAdjust
        counts={regions ?? { hidden: 0, both: 0, fresh: 0 }}
        edits={POST_EDITS}
        allowed={isExpressible}
        onApply={onAdjust}
        disabled={
          regions
            ? undefined
            : "A meaning search ranks Posts, which a rule cannot repeat. Select or deselect its results instead."
        }
      />
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
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <BarToggle
          on={selectedFirst}
          onClick={() => onSelectedFirstChange(!selectedFirst)}
          label="Selected first"
          title="Selected Posts first, each part in the feed's order"
        />
        <button
          type="button"
          className={pillClass(false)}
          title="Copy the Telegram links of the selected Posts the filter shows"
          onClick={onCopyLinks}
        >
          <Link2 size={12} /> Copy links
        </button>
        <button
          type="button"
          className={pillClass(false)}
          title="Download the selected Posts the filter shows as Markdown"
          onClick={onExportMarkdown}
        >
          <FileDown size={12} /> Export Markdown
        </button>
      </div>
    </section>
  )
}
