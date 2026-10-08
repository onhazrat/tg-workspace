import { ExternalLink, Snowflake } from "lucide-react"
import { useLayoutEffect, useRef, useState } from "react"
import { ChannelAvatar } from "@/components/ChannelAvatar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tg-tooltip"
import { telegramWebViewChannelUrl } from "@/lib/telegram-web"
import type { Channel } from "@/types"
import { useCardVariant } from "../channel-card-prototype/shared"
import { CHANNEL_SHORTCUTS } from "../channel-grid/ChannelGridKeyboard"

/** Avatar with its Telegram link, the title with a Frozen mark, the handle, and the bio. */
export function ChannelCardHeader({
  channel,
  showBio,
  fullBio = false,
  linkToTelegram,
}: {
  channel: Channel
  showBio: boolean
  /** The whole bio instead of two clamped lines. */
  fullBio?: boolean
  /** Off where the card body selects, since the link would sit under it. */
  linkToTelegram: boolean
}) {
  const channelTitle = channel.displayName || channel.name
  // PROTOTYPE: the photo viewer, full bio and bio toggle are D's; 0 is main.
  const isD = useCardVariant() !== "0"
  return (
    <>
      <div className="flex items-start gap-4 mb-4">
        <div
          // PROTOTYPE: on D the photo sits above a compact card's selection
          // overlay, so a click on it opens the viewer.
          className={`relative flex-shrink-0 ${isD ? "z-20" : ""}`}
        >
          <ChannelAvatar
            channel={channel}
            viewable={isD}
            viewShortcut={CHANNEL_SHORTCUTS.photo}
          />
          {linkToTelegram && (
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={telegramWebViewChannelUrl(channel.name)}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-shortcut={CHANNEL_SHORTCUTS.open}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute -bottom-1 -right-1 w-6 h-6 bg-app-bg border border-app-ink/10 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all shadow-sm hover:bg-app-ink hover:text-app-bg"
                >
                  <ExternalLink size={10} />
                </a>
              </TooltipTrigger>
              <TooltipContent>
                <p>Open in Telegram</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        <div className="flex-1 min-w-0 pt-1">
          {/* `truncate` must sit on the text's own element. This <h4> is a flex
              container, which makes a bare text child an *anonymous* flex item —
              `text-overflow: ellipsis` does not apply to those, so the title
              clipped mid-glyph with no ellipsis. `min-w-0` lets the span shrink
              below its content width instead of pushing the badge out. */}
          <h4 className="font-bold text-lg leading-tight mb-1 text-app-ink flex items-center gap-2 min-w-0">
            <span className="truncate min-w-0" title={channelTitle}>
              {channelTitle}
            </span>
            {channel.isFrozen && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Snowflake
                    size={14}
                    className="text-blue-500 flex-shrink-0"
                    data-testid="channel-card-frozen-mark"
                  />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Channel is Frozen (Sync Disabled)</p>
                </TooltipContent>
              </Tooltip>
            )}
          </h4>
          <p className="text-[11px] opacity-50 font-mono truncate">
            @{channel.name}
          </p>
        </div>
      </div>

      {showBio &&
        channel.bio &&
        (isD ? (
          <ChannelBio bio={channel.bio} full={fullBio} />
        ) : (
          <div className="mb-4">
            <p
              dir="auto"
              className="text-[11px] leading-relaxed text-app-ink/70 line-clamp-2 whitespace-pre-wrap"
              title={channel.bio}
            >
              {channel.bio}
            </p>
          </div>
        ))}
    </>
  )
}

/**
 * The bio, two lines on a normal card with a More/Less toggle when it runs
 * longer, and whole on a detailed card. Whether it runs longer is measured,
 * since it depends on the card's width, which changes with the column count.
 */
export function ChannelBio({ bio, full }: { bio: string; full: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)
  const ref = useRef<HTMLParagraphElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || full || expanded) return
    const check = () => setClamped(el.scrollHeight > el.clientHeight + 1)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [bio, full, expanded])

  const open = full || expanded
  return (
    <div className="mb-4">
      <p
        ref={ref}
        dir="auto"
        className={`text-[11px] leading-relaxed text-app-ink/70 whitespace-pre-wrap ${open ? "" : "line-clamp-2"}`}
      >
        {bio}
      </p>
      {!full && (clamped || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          data-shortcut={CHANNEL_SHORTCUTS.bio}
          onClick={(e) => {
            e.stopPropagation()
            setExpanded(!expanded)
          }}
          className="mt-0.5 text-[10px] font-bold text-app-ink/50 hover:text-app-ink"
        >
          {expanded ? "Less" : "More"}
        </button>
      )}
    </div>
  )
}
