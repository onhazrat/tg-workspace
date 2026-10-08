import { ExternalLink, Snowflake } from "lucide-react"
import { useLayoutEffect, useRef, useState } from "react"
import {
  ChannelAvatar,
  PHOTO_CORNER_BUTTON_CLASS,
} from "@/components/ChannelAvatar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tg-tooltip"
import { telegramWebViewChannelUrl } from "@/lib/telegram-web"
import type { Channel } from "@/types"

/**
 * The Channel's photo with "Open in Telegram" at its bottom right, the same
 * at every card size. The photo opens the viewer: by itself on a card, by a
 * magnifier at its bottom left on a tile, whose body selects.
 */
export function ChannelCardPhoto({
  channel,
  view,
  className,
}: {
  channel: Channel
  view: "image" | "corner"
  className?: string
}) {
  return (
    <div className="relative flex-shrink-0">
      <ChannelAvatar channel={channel} className={className} view={view} />
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={telegramWebViewChannelUrl(channel.name)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${channel.displayName || channel.name} in Telegram`}
            onClick={(e) => e.stopPropagation()}
            className={`${PHOTO_CORNER_BUTTON_CLASS} -right-1`}
          >
            <ExternalLink size={10} />
          </a>
        </TooltipTrigger>
        <TooltipContent>
          <p>Open in Telegram</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

/** The photo, the title with a Frozen mark, and the handle. */
export function ChannelCardHeader({ channel }: { channel: Channel }) {
  const channelTitle = channel.displayName || channel.name
  return (
    <div className="flex items-start gap-4 mb-4">
      <ChannelCardPhoto channel={channel} view="image" />

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
  )
}

const BIO_CLAMP = { 2: "line-clamp-2", 4: "line-clamp-4" } as const

/**
 * The bio, cut at `lines` with a More/Less toggle shown only while text is
 * hidden. Whether it is hidden depends on the card's width, which changes
 * with the column count, so it is measured again whenever the text resizes.
 */
export function ChannelCardBio({ bio, lines }: { bio: string; lines: 2 | 4 }) {
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)
  const ref = useRef<HTMLParagraphElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    // Expanded text hides nothing, but Less must stay: keep the last answer.
    if (!el || expanded) return
    const check = () => setClamped(el.scrollHeight > el.clientHeight + 1)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [bio, expanded])

  return (
    <div className="mb-4">
      <p
        ref={ref}
        dir="auto"
        data-lines={expanded ? undefined : lines}
        className={`text-[11px] leading-relaxed text-app-ink/70 whitespace-pre-wrap ${expanded ? "" : BIO_CLAMP[lines]}`}
      >
        {bio}
      </p>
      {clamped && (
        <button
          type="button"
          aria-expanded={expanded}
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
