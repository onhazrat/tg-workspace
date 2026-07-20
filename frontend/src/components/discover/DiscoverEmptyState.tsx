import type React from "react"
import { TgFilterChip } from "@/components/ui/tg-chips"
import type {
  DiscoveryQuickAction,
  DiscoveryEmptyState as EmptyStateSpec,
} from "@/lib/posts/discover-empty-state"

interface DiscoverEmptyStateProps {
  state: EmptyStateSpec
  onQuickAction: (action: DiscoveryQuickAction) => void
}

export const DiscoverEmptyState: React.FC<DiscoverEmptyStateProps> = ({
  state,
  onQuickAction,
}) => (
  <div className="space-y-3" data-testid="discover-empty-state">
    <p className="text-sm font-medium text-app-ink">{state.title}</p>
    <p className="text-sm text-app-ink/60">{state.body}</p>
    {state.quickActions.length > 0 ? (
      <div className="flex flex-wrap gap-2">
        {state.quickActions.map((quickAction) => (
          <TgFilterChip
            key={quickAction.label}
            onClick={() => onQuickAction(quickAction.action)}
          >
            {quickAction.label}
          </TgFilterChip>
        ))}
      </div>
    ) : null}
  </div>
)
