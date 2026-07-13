import { Layers } from "lucide-react"
import type React from "react"
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

        return (
          <button
            type="button"
            key={group.id}
            data-testid={`channel-group-${group.id}`}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey) {
                onSetGroupFilter(activeGroupFilter === group.id ? "" : group.id)
                return
              }
              onToggleGroupSelection(group.id)
            }}
            className={`text-[9px] font-bold px-2 py-1 rounded-md transition-all flex items-center gap-1.5 ${
              isActiveFilter ? "ring-2 ring-indigo-500/40" : ""
            } ${
              isAllSelected
                ? "bg-app-ink text-app-bg"
                : isPartial
                  ? "bg-app-ink/20 text-app-ink"
                  : "bg-app-muted/50 text-app-ink/60 hover:bg-app-ink/10 hover:text-app-ink"
            }`}
          >
            <Layers size={10} />
            {group.name}
            <span className="opacity-60 text-[8px]">
              ({selectedCount}/{channelsWithGroup.length})
            </span>
          </button>
        )
      })}
    </div>
  )
}
