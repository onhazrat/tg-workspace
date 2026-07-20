import type React from "react"
import { TgFilterChip } from "@/components/ui/tg-chips"
import { TgInput } from "@/components/ui/tg-input"
import { TgSegmentedControl } from "@/components/ui/tg-segmented"
import {
  DISCOVER_FOLLOW_STATE_OPTIONS,
  DISCOVER_MIN_TOTAL_OPTIONS,
  DISCOVERY_SIGNAL_KINDS,
  DISCOVERY_SIGNAL_LABELS,
  type DiscoverFollowState,
  type DiscoverySignalKind,
} from "@/lib/posts/discover-candidates"

interface DiscoverFilterBarProps {
  signals: DiscoverySignalKind[]
  onToggleSignal: (kind: DiscoverySignalKind) => void
  followState: DiscoverFollowState
  onFollowStateChange: (state: DiscoverFollowState) => void
  minTotal: number
  onMinTotalChange: (minTotal: number) => void
  nameQuery: string
  onNameQueryChange: (query: string) => void
}

export const DiscoverFilterBar: React.FC<DiscoverFilterBarProps> = ({
  signals,
  onToggleSignal,
  followState,
  onFollowStateChange,
  minTotal,
  onMinTotalChange,
  nameQuery,
  onNameQueryChange,
}) => (
  <div
    className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3"
    data-testid="discover-filter-bar"
  >
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-bold uppercase tracking-widest text-app-ink/50">
        Signals
      </span>
      {DISCOVERY_SIGNAL_KINDS.map((kind) => (
        <TgFilterChip
          key={kind}
          data-testid={`discover-signal-${kind}`}
          selected={signals.includes(kind)}
          onClick={() => onToggleSignal(kind)}
        >
          {DISCOVERY_SIGNAL_LABELS[kind]}
        </TgFilterChip>
      ))}
    </div>

    <div className="flex items-center gap-2">
      <span className="text-[11px] font-bold uppercase tracking-widest text-app-ink/50">
        Show
      </span>
      <TgSegmentedControl
        size="sm"
        aria-label="Filter candidates by follow state"
        value={followState}
        onChange={onFollowStateChange}
        options={DISCOVER_FOLLOW_STATE_OPTIONS.map((option) => ({
          ...option,
          "data-testid": `discover-follow-state-${option.value}`,
        }))}
      />
    </div>

    <div className="flex items-center gap-2">
      <span className="text-[11px] font-bold uppercase tracking-widest text-app-ink/50">
        Min hits
      </span>
      <TgSegmentedControl
        size="sm"
        aria-label="Minimum total references"
        value={String(minTotal)}
        onChange={(value) => onMinTotalChange(Number.parseInt(value, 10))}
        options={DISCOVER_MIN_TOTAL_OPTIONS.map((option) => ({
          label: option.label,
          value: String(option.value),
          "data-testid": `discover-min-total-${option.value}`,
        }))}
      />
    </div>

    <TgInput
      variant="muted"
      type="search"
      value={nameQuery}
      onChange={(event) => onNameQueryChange(event.target.value)}
      placeholder="Filter by name…"
      aria-label="Filter candidates by name"
      data-testid="discover-name-filter"
      className="w-44"
    />
  </div>
)
