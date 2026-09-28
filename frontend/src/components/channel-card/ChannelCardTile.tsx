import { Loader2 } from "lucide-react"
import { ChannelAvatar } from "@/components/ChannelAvatar"
import type { Channel } from "@/types"
import { channelCardFrameClass } from "./channel-card-status"

/**
 * The channel card at zoom -2: the avatar alone, and the whole tile toggles
 * selection. It reuses the card's frame, so selected, frozen and syncing read
 * the same here as on the full card.
 */
export function ChannelCardTile({
  channel,
  isSelected,
  isScraping,
  onToggleSelected,
}: {
  channel: Channel
  isSelected: boolean
  isScraping: boolean
  onToggleSelected: () => void
}) {
  return (
    <button
      type="button"
      data-channel-name={channel.name}
      aria-pressed={isSelected}
      aria-label={
        isSelected ? `Deselect ${channel.name}` : `Select ${channel.name}`
      }
      title={`${channel.displayName || channel.name}\n@${channel.name}`}
      onClick={onToggleSelected}
      className={`${channelCardFrameClass({
        isFrozen: channel.isFrozen,
        isSelected,
        isScraping,
      })} aspect-square w-full items-center justify-center p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ink/30`}
    >
      <ChannelAvatar channel={channel} className="w-12 h-12" />
      {isScraping && (
        <Loader2
          size={24}
          className="absolute inset-0 m-auto animate-spin text-app-ink"
        />
      )}
    </button>
  )
}
