import type React from "react"
import { TgFilterChip } from "@/components/ui/tg-chips"
import {
  DISCOVER_SORT_OPTIONS,
  type DiscoverSortKey,
} from "@/lib/posts/discover-candidates"

interface DiscoverSortChipsProps {
  sortKey: DiscoverSortKey
  onSortKeyChange: (key: DiscoverSortKey) => void
}

export const DiscoverSortChips: React.FC<DiscoverSortChipsProps> = ({
  sortKey,
  onSortKeyChange,
}) => (
  <div className="flex flex-wrap items-center gap-2">
    <span className="text-[11px] font-bold uppercase tracking-widest text-app-ink/50">
      Sort by
    </span>
    {DISCOVER_SORT_OPTIONS.map((option) => (
      <TgFilterChip
        key={option.value}
        data-testid={`discover-sort-${option.value}`}
        selected={sortKey === option.value}
        onClick={() => onSortKeyChange(option.value)}
      >
        {option.label}
      </TgFilterChip>
    ))}
  </div>
)
