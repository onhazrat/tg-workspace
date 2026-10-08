import { Loader2, RefreshCw, Snowflake } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tg-tooltip"
import { shortcut } from "@/lib/channels/card-zoom"
import { channelAllows } from "@/lib/channels/sync-permissions"
import type { Channel } from "@/types"
import { ChannelCardPhoto } from "./ChannelCardHeader"
import {
  channelCardFrameClass,
  selectionHandlers,
  selectLabel,
} from "./channel-card-status"

/**
 * The channel card at zoom -2: the avatar alone, and a click on the tile
 * toggles selection. The selection is an overlay rather than the tile itself,
 * because a button may not hold the photo's magnifier or its Telegram link,
 * which sit above it. It reuses the card's frame, so selected and syncing
 * read the same here as on the full card; a frozen avatar is greyed and
 * marked, because the frame's fade alone is lost in a wall of avatars. The
 * name and handle are the app's tooltip, not `title`, whose delay the
 * browser picks. Sync sits at the top left on hover, so keyboard mode's `s`
 * presses a control here as on every other size.
 */
export function ChannelCardTile({
  channel,
  isSelected,
  isScraping,
  busy,
  highlighted = false,
  onToggleSelected,
  onSync,
}: {
  channel: Channel
  isSelected: boolean
  isScraping: boolean
  /** A sync or summary is running. */
  busy: boolean
  /** Keyboard mode's highlight is on this tile. */
  highlighted?: boolean
  onToggleSelected: (shift: boolean) => void
  onSync: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          data-channel-name={channel.name}
          data-kbd-selected={highlighted || undefined}
          className={`${channelCardFrameClass({
            isFrozen: channel.isFrozen,
            isSelected,
            isScraping,
            highlighted,
          })} aspect-square w-full items-center justify-center p-2`}
        >
          <button
            type="button"
            aria-pressed={isSelected}
            aria-label={selectLabel(channel.name, isSelected)}
            {...selectionHandlers(onToggleSelected)}
            {...shortcut("x")}
            className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ink/30"
          />
          <ChannelCardPhoto
            channel={channel}
            view="corner"
            className={`w-12 h-12 ${channel.isFrozen ? "opacity-40 grayscale" : ""}`}
          />
          <button
            type="button"
            aria-label={channel.isUnavailableOnWebView ? "Recheck" : "Sync"}
            {...shortcut("s")}
            onClick={(e) => {
              e.stopPropagation()
              onSync()
            }}
            disabled={busy || !channelAllows(channel, "individual")}
            className="absolute top-1 left-1 z-20 flex h-6 w-6 items-center justify-center rounded-full border border-app-ink/10 bg-app-bg opacity-0 shadow-sm transition-all group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:bg-app-ink hover:text-app-bg disabled:hidden"
          >
            <RefreshCw size={10} />
          </button>
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
      </TooltipTrigger>
      <TooltipContent>
        <p className="font-bold">{channel.displayName || channel.name}</p>
        <p className="font-mono opacity-70">@{channel.name}</p>
      </TooltipContent>
    </Tooltip>
  )
}
