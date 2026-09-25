import { ExternalLink, Snowflake } from "lucide-react"
import { ChannelAvatar } from "@/components/ChannelAvatar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tg-tooltip"
import { telegramWebViewChannelUrl } from "@/lib/telegram-web"
import type { Channel } from "@/types"

/** Avatar with its Telegram link, the title with a Frozen mark, the handle, and the bio. */
export function ChannelCardHeader({
  channel,
  showBio,
}: {
  channel: Channel
  showBio: boolean
}) {
  const channelTitle = channel.displayName || channel.name
  return (
    <>
      <div className="flex items-start gap-4 mb-4">
        <div className="relative flex-shrink-0">
          <ChannelAvatar channel={channel} />
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={telegramWebViewChannelUrl(channel.name)}
                target="_blank"
                rel="noopener noreferrer"
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

      {showBio && channel.bio && (
        <div className="mb-4">
          <p
            dir="auto"
            className="text-[11px] leading-relaxed text-app-ink/70 line-clamp-2 whitespace-pre-wrap"
            title={channel.bio}
          >
            {channel.bio}
          </p>
        </div>
      )}
    </>
  )
}
