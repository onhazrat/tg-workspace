import { Tag } from "lucide-react"
import type React from "react"
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

        return (
          <button
            type="button"
            key={tag}
            onClick={() => onToggleTag(tag)}
            className={`text-[9px] font-bold px-2 py-1 rounded-md transition-all flex items-center gap-1.5 ${
              isAllSelected
                ? "bg-app-ink text-app-bg"
                : isPartial
                  ? "bg-app-ink/20 text-app-ink"
                  : "bg-app-muted/50 text-app-ink/60 hover:bg-app-ink/10 hover:text-app-ink"
            }`}
          >
            <Tag size={10} />
            {tag}
            <span className="opacity-60 text-[8px]">
              ({selectedCount}/{channelsWithTag.length})
            </span>
          </button>
        )
      })}
      {showUntaggedTagChip && (
        <button
          type="button"
          key={UNTAGGED_TAG_ID}
          data-testid="channel-tag-untagged"
          onClick={() => onToggleTag(UNTAGGED_TAG_ID)}
          className={`text-[9px] font-bold px-2 py-1 rounded-md transition-all flex items-center gap-1.5 ${
            untagged.isAllSelected
              ? "bg-app-ink text-app-bg"
              : untagged.isPartial
                ? "bg-app-ink/20 text-app-ink"
                : "bg-app-muted/50 text-app-ink/60 hover:bg-app-ink/10 hover:text-app-ink"
          }`}
        >
          <Tag size={10} />
          {UNTAGGED_TAG_LABEL}
          <span className="opacity-60 text-[8px]">
            ({untagged.selectedCount}/{untaggedChannelNames.length})
          </span>
        </button>
      )}
    </div>
  )
}
