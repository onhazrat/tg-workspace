import { Tag } from "lucide-react"
import type React from "react"
import { TgSelectionChip } from "@/components/ui/tg-chips"
import {
  getChannelNamesWithTag,
  getChipSelectionState,
} from "@/lib/channels/channel-grid-chips"
import {
  UNTAGGED_TAG_ID,
  UNTAGGED_TAG_LABEL,
} from "@/lib/channels/channel-tags"
import type { Channel } from "@/types"

type ChannelTagChipsProps = {
  channels: Channel[]
  selectedChannels: Set<string>
  visibleTags: string[]
  showUntaggedTagChip: boolean
  untaggedChannelNames: string[]
  onToggleTag: (tag: string) => void
}

/** Tag chip row, including the synthetic "Untagged" chip. Click toggles selection of matching channels. */
export const ChannelTagChips: React.FC<ChannelTagChipsProps> = ({
  channels,
  selectedChannels,
  visibleTags,
  showUntaggedTagChip,
  untaggedChannelNames,
  onToggleTag,
}) => {
  const untagged = getChipSelectionState(untaggedChannelNames, selectedChannels)

  return (
    <div className="flex flex-wrap gap-2">
      {visibleTags.map((tag) => {
        const channelsWithTag = getChannelNamesWithTag(channels, tag)
        const { selectedCount, isAllSelected, isPartial } =
          getChipSelectionState(channelsWithTag, selectedChannels)
        const state = isAllSelected
          ? "selected"
          : isPartial
            ? "partial"
            : "idle"

        return (
          <TgSelectionChip
            key={tag}
            state={state}
            onClick={() => onToggleTag(tag)}
          >
            <Tag size={10} />
            {tag}
            <span className="opacity-60 text-[8px]">
              ({selectedCount}/{channelsWithTag.length})
            </span>
          </TgSelectionChip>
        )
      })}
      {showUntaggedTagChip && (
        <TgSelectionChip
          key={UNTAGGED_TAG_ID}
          state={
            untagged.isAllSelected
              ? "selected"
              : untagged.isPartial
                ? "partial"
                : "idle"
          }
          data-testid="channel-tag-untagged"
          onClick={() => onToggleTag(UNTAGGED_TAG_ID)}
        >
          <Tag size={10} />
          {UNTAGGED_TAG_LABEL}
          <span className="opacity-60 text-[8px]">
            ({untagged.selectedCount}/{untaggedChannelNames.length})
          </span>
        </TgSelectionChip>
      )}
    </div>
  )
}
