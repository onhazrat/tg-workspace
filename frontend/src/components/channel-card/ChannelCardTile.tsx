import { Loader2, Snowflake } from "lucide-react"
import { ChannelAvatar } from "@/components/ChannelAvatar"
import type { Channel } from "@/types"
import { useCardVariant } from "../channel-card-prototype/shared"
import {
  CHANNEL_SHORTCUTS,
  KBD_RING,
} from "../channel-grid/ChannelGridKeyboard"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tg-tooltip"
import {
  channelCardFrameClass,
  selectionHandlers,
  selectLabel,
} from "./channel-card-status"

/**
 * The channel card at zoom -2: the avatar alone, and the whole tile toggles
 * selection. It reuses the card's frame, so selected and syncing read the same
 * here as on the full card; a frozen avatar is greyed and marked, because the
 * frame's fade alone is lost in a wall of avatars. PROTOTYPE: on D the
 * name and handle are the app's tooltip rather than `title`, whose delay the
 * browser picks.
 */
export function ChannelCardTile({
  channel,
  isSelected,
  isScraping,
  keyboardRing = false,
  onToggleSelected,
}: {
  channel: Channel
  isSelected: boolean
  isScraping: boolean
  keyboardRing?: boolean
  onToggleSelected: (shift: boolean) => void
}) {
  const variant = useCardVariant()
  const tile = (
    <button
      type="button"
      data-channel-name={channel.name}
      // PROTOTYPE: 0 keeps the native title, D the app's tooltip.
      title={
        variant === "0"
          ? `${channel.displayName || channel.name}\n@${channel.name}`
          : undefined
      }
      data-kbd-selected={keyboardRing ? "" : undefined}
      data-shortcut={CHANNEL_SHORTCUTS.select}
      aria-pressed={isSelected}
      aria-label={selectLabel(channel.name, isSelected)}
      {...selectionHandlers(onToggleSelected)}
      className={`${channelCardFrameClass({
        isFrozen: channel.isFrozen,
        isSelected,
        isScraping,
      })} ${KBD_RING} aspect-square w-full items-center justify-center p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ink/30`}
    >
      <ChannelAvatar
        channel={channel}
        className={`w-12 h-12 ${channel.isFrozen ? "opacity-40 grayscale" : ""}`}
      />
      {channel.isFrozen && (
        <Snowflake
          size={12}
          aria-label="Frozen"
          className="absolute top-1.5 right-1.5 text-blue-500"
        />
      )}
      {isScraping && (
        <Loader2
          size={24}
          className="absolute inset-0 m-auto animate-spin text-app-ink"
        />
      )}
    </button>
  )
  if (variant === "0") return tile
  const frame = (
    <div
      data-channel-name={channel.name}
      data-kbd-selected={keyboardRing ? "" : undefined}
      className={`${channelCardFrameClass({
        isFrozen: channel.isFrozen,
        isSelected,
        isScraping,
      })} ${KBD_RING} aspect-square w-full items-center justify-center p-2`}
    >
      {/* PROTOTYPE: on D the tile is a frame with its selection as an
          overlay, because a button may not hold the photo's button. */}
      <button
        type="button"
        data-shortcut={CHANNEL_SHORTCUTS.select}
        aria-pressed={isSelected}
        aria-label={selectLabel(channel.name, isSelected)}
        {...selectionHandlers(onToggleSelected)}
        className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ink/30"
      />
      <ChannelAvatar
        channel={channel}
        className={`w-12 h-12 ${channel.isFrozen ? "opacity-40 grayscale" : ""}`}
        viewable
        viewTrigger="corner"
        viewShortcut={CHANNEL_SHORTCUTS.photo}
      />
      {channel.isFrozen && (
        <Snowflake
          size={12}
          aria-label="Frozen"
          className="absolute top-1.5 right-1.5 text-blue-500"
        />
      )}
      {isScraping && (
        <Loader2
          size={24}
          className="absolute inset-0 m-auto animate-spin text-app-ink"
        />
      )}
    </div>
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>{frame}</TooltipTrigger>
      <TooltipContent>
        <p className="font-bold">{channel.displayName || channel.name}</p>
        <p className="font-mono opacity-70">@{channel.name}</p>
      </TooltipContent>
    </Tooltip>
  )
}
