import { Layers } from "lucide-react"
import type React from "react"
import { TgSelectionChip } from "@/components/ui/tg-chips"
import {
  getChannelNamesInGroup,
  getChipSelectionState,
} from "@/lib/channels/channel-grid-chips"
import type { Channel, ChannelSettingGroup } from "@/types"

type ChannelGroupChipsProps = {
  groups: ChannelSettingGroup[]
  channels: Channel[]
  selectedChannels: Set<string>
  activeGroupFilter: string
  onToggleGroupSelection: (groupId: string) => void
  onSetGroupFilter: (groupId: string) => void
}

/** Setting-group chip row: click toggles selection, cmd/ctrl-click toggles the group filter. */
export const ChannelGroupChips: React.FC<ChannelGroupChipsProps> = ({
  groups,
  channels,
  selectedChannels,
  activeGroupFilter,
  onToggleGroupSelection,
  onSetGroupFilter,
}) => {
  return (
    <div className="flex flex-wrap gap-2">
      {groups.map((group) => {
        const channelsWithGroup = getChannelNamesInGroup(channels, group.id)
        const { selectedCount, isAllSelected, isPartial } =
          getChipSelectionState(channelsWithGroup, selectedChannels)
        const isActiveFilter = activeGroupFilter === group.id
        const state = isAllSelected
          ? "selected"
          : isPartial
            ? "partial"
            : "idle"

        return (
          <TgSelectionChip
            key={group.id}
            state={state}
            data-testid={`channel-group-${group.id}`}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey) {
                onSetGroupFilter(activeGroupFilter === group.id ? "" : group.id)
                return
              }
              onToggleGroupSelection(group.id)
            }}
            className={isActiveFilter ? "ring-2 ring-indigo-500/40" : undefined}
          >
            <Layers size={10} />
            {group.name}
            <span className="opacity-60 text-[8px]">
              ({selectedCount}/{channelsWithGroup.length})
            </span>
          </TgSelectionChip>
        )
      })}
    </div>
  )
}
