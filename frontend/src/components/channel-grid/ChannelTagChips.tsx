import { ChevronDown, Tag } from "lucide-react"
import type React from "react"
import { useLayoutEffect, useRef, useState } from "react"
import { TgSelectionChip } from "@/components/ui/tg-chips"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tg-tooltip"
import {
  getChannelNamesWithTag,
  getChipSelectionState,
} from "@/lib/channels/channel-grid-chips"
import type { ChannelPseudoTagChip } from "@/lib/channels/channel-tags"
import {
  COLLAPSED_TAG_WALL_MAX_PX,
  isTagWallOverflowing,
  tagWallToggleLabel,
} from "@/lib/channels/tag-chip-collapse"
import type { Channel } from "@/types"

type ChannelTagChipsProps = {
  channels: Channel[]
  selectedChannels: Set<string>
  visibleTags: string[]
  pseudoTagChips: ChannelPseudoTagChip[]
  onToggleTag: (tag: string) => void
}

/** Tag chip row, including the synthetic pseudo-tag chips ("Untagged", "Partial history"). Click toggles selection of matching channels. */
export const ChannelTagChips: React.FC<ChannelTagChipsProps> = ({
  channels,
  selectedChannels,
  visibleTags,
  pseudoTagChips,
  onToggleTag,
}) => {
  const listRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const totalChips = visibleTags.length + pseudoTagChips.length

  /**
   * Measured rather than guessed from the chip count: chip width follows the tag
   * name, so N chips can be one row or five.
   *
   * Only measured while collapsed — expanding makes `scrollHeight` equal
   * `clientHeight`, which would report "no overflow" and hide the control that
   * collapses it again. The last collapsed reading therefore stands while open.
   */
  useLayoutEffect(() => {
    const element = listRef.current
    if (!element || expanded) return

    const check = () =>
      setOverflows(
        isTagWallOverflowing(element.scrollHeight, element.clientHeight),
      )
    check()

    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(check)
    observer.observe(element)
    return () => observer.disconnect()
  }, [expanded, totalChips])

  return (
    <div>
      <div
        ref={listRef}
        className="flex flex-wrap gap-2 overflow-hidden"
        style={
          expanded ? undefined : { maxHeight: `${COLLAPSED_TAG_WALL_MAX_PX}px` }
        }
      >
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
        {pseudoTagChips.map((chip) => {
          const { selectedCount, isAllSelected, isPartial } =
            getChipSelectionState(chip.channelNames, selectedChannels)
          const Icon = chip.icon

          return (
            <Tooltip key={chip.id}>
              <TooltipTrigger asChild>
                <TgSelectionChip
                  state={
                    isAllSelected ? "selected" : isPartial ? "partial" : "idle"
                  }
                  data-testid={chip.testId}
                  onClick={() => onToggleTag(chip.id)}
                >
                  <Icon size={10} />
                  {chip.label}
                  <span className="opacity-60 text-[8px]">
                    ({selectedCount}/{chip.channelNames.length})
                  </span>
                </TgSelectionChip>
              </TooltipTrigger>
              <TooltipContent>
                <p>{chip.tooltip}</p>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>

      {(overflows || expanded) && (
        <button
          type="button"
          data-testid="channel-tag-wall-toggle"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="mt-2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-app-ink/50 hover:text-app-ink/80 focus-visible:text-app-ink/80 transition-colors"
        >
          <ChevronDown
            size={12}
            className={`transition-transform ${expanded ? "rotate-180" : ""}`}
          />
          {tagWallToggleLabel(totalChips, expanded)}
        </button>
      )}
    </div>
  )
}
