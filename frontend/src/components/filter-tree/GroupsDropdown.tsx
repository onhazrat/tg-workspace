/**
 * The Groups dropdown the Directory and the Requests tab share (TGU-04), the
 * Channels tab's: a row per Setting group with its followed channels in the
 * tab's scope, how many the tab's selection holds, the gear that opens the
 * group in Settings, and the funnel. Setting groups are not Tags, so this is
 * apart from the Tags dropdown.
 */
import { useRouter } from "@tanstack/react-router"
import { Layers, Settings } from "lucide-react"
import { useMemo } from "react"
import { ChannelFacetMenu } from "@/components/channel-grid/ChannelFacetMenu"
import { useChannelsQuery } from "@/hooks/useChannels"
import { useSettingGroupsQuery } from "@/hooks/useSettingGroups"
import { sortSettingGroupsForDisplay } from "@/lib/channels/setting-groups"
import type { FacetRowAction } from "./FacetMenuManage"

/** One Setting group and its followed channels in scope, lowercased. */
export type GroupRow = {
  id: string
  name: string
  isDefault?: boolean
  handles: string[]
}

/** The gear on a Groups row: open that Setting group in Settings. */
export const settingGroupGear = (
  onOpen: (id: string) => void,
): FacetRowAction => ({
  icon: <Settings size={11} />,
  label: (row) => `Open ${row.label}'s settings`,
  onClick: (row) => onOpen(row.id),
})

/**
 * Open Settings at the Setting groups panel with one group open. Outside a
 * router, as in a component test, it does nothing.
 */
export function useOpenSettingGroup(): (id: string) => void {
  const router = useRouter({ warn: false })
  return (id) =>
    void router?.navigate({
      to: "/",
      search: (prev) => ({
        ...prev,
        tab: "settings" as const,
        section: undefined,
        setting: "sync.yours.settingGroups",
        settingGroup: id,
      }),
    })
}

/**
 * The reader's Setting groups in display order, each with the channels they
 * follow in it; only those in `scope` when it is given (lowercased handles).
 */
export function useGroupRows(scope: readonly string[] | null): GroupRow[] {
  const { data: channels = NO_CHANNELS } = useChannelsQuery()
  const { data: groups = NO_GROUPS } = useSettingGroupsQuery()
  return useMemo(() => {
    const inScope = scope && new Set(scope.map((h) => h.toLowerCase()))
    return sortSettingGroupsForDisplay(groups).map((group) => ({
      id: group.id,
      name: group.name,
      isDefault: group.isDefault,
      handles: channels
        .filter((c) => c.settingGroupId === group.id)
        .map((c) => c.name.toLowerCase())
        .filter((h) => !inScope || inScope.has(h)),
    }))
  }, [channels, groups, scope])
}

const NO_CHANNELS: never[] = []
const NO_GROUPS: never[] = []

type GroupsDropdownProps = {
  testId: string
  /** The line over the rows: what selecting a group does on this tab. */
  tickHint: string
  groups: GroupRow[]
  /** The tab's selection, lowercased handles. */
  selected: ReadonlySet<string>
  /** Add a group's handles to the tab's selection, or take them out. */
  onSelect: (handles: string[], on: boolean) => void
  /** The funnelled group ids. */
  funnelled: string[]
  onFunnel: (id: string, on: boolean) => void
  onClearFunnels: () => void
  /** Open the group in Settings. */
  onOpen: (id: string) => void
}

export function GroupsDropdown(p: GroupsDropdownProps) {
  const name = (id: string) => p.groups.find((g) => g.id === id)?.name ?? id
  return (
    <ChannelFacetMenu
      icon={<Layers size={12} />}
      label="Groups"
      noun="group"
      testId={p.testId}
      tickHint={p.tickHint}
      rows={p.groups.map((g) => ({
        id: g.id,
        label: g.name,
        hint: g.isDefault ? "default" : undefined,
        names: g.handles,
      }))}
      selectedChannels={p.selected}
      onToggleSelect={(row) =>
        p.onSelect(row.names, !row.names.every((h) => p.selected.has(h)))
      }
      funnelled={p.funnelled}
      labelOf={name}
      onFunnel={p.onFunnel}
      onClearFunnels={p.onClearFunnels}
      rowAction={settingGroupGear(p.onOpen)}
    />
  )
}
