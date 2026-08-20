import { COMPACT_WORKSPACE_TAB_IDS, WORKSPACE_TABS } from "@/constants"
import type { TabType } from "@/types"

type WorkspaceTab = (typeof WORKSPACE_TABS)[number]

/**
 * Which tabs the nav shows.
 *
 * `compact` hides the four feature tabs, because Action is the one place work
 * starts and History is where results are found. Two rules make that safe:
 *
 * 1. **The active tab is always shown**, even when compact would hide it. You
 *    land on a hidden tab constantly — every artifact opened from History goes
 *    to one — and a nav that refuses to admit where you are is worse than a
 *    nav with one extra entry. The entry disappears when you navigate away.
 * 2. **`VALID_TABS` is never filtered.** Hiding is a decluttering choice, not a
 *    capability removal: deep links, palette commands and `setActiveTab` calls
 *    all keep working. That is asserted in `architecture-invariants.test.ts`.
 */
export function visibleWorkspaceTabs(
  compact: boolean,
  activeTab: TabType,
): readonly WorkspaceTab[] {
  if (!compact) return WORKSPACE_TABS
  return WORKSPACE_TABS.filter(
    (tab) => COMPACT_WORKSPACE_TAB_IDS.includes(tab.id) || tab.id === activeTab,
  )
}
