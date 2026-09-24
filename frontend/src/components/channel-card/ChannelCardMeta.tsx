import {
  Activity,
  Clock,
  File,
  Image as ImageIcon,
  Link as LinkIcon,
  type LucideIcon,
  Users,
  Video,
} from "lucide-react"
import type { ReactNode } from "react"
import { formatCount } from "@/lib/format-count"
import type { Channel, ChannelStats } from "@/types"
import { RelativeTime } from "../RelativeTime"
import { TgMetaChip } from "../ui/tg-chips"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tg-tooltip"

/** Which optional channel counters the user's settings put on the card. */
export interface ChannelMetaVisibility {
  subscribers: boolean
  telegramChatId: boolean
  photos: boolean
  videos: boolean
  files: boolean
  links: boolean
}

const COUNTERS: {
  key: "photos" | "videos" | "files" | "links"
  label: string
  Icon: LucideIcon
}[] = [
  { key: "photos", label: "Photos", Icon: ImageIcon },
  { key: "videos", label: "Videos", Icon: Video },
  { key: "files", label: "Files", Icon: File },
  { key: "links", label: "Links", Icon: LinkIcon },
]

function ChipWithTooltip({
  className = "uppercase tracking-wider cursor-help",
  tooltip,
  children,
}: {
  className?: string
  tooltip: ReactNode
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <TgMetaChip size="card" className={className}>
          {children}
        </TgMetaChip>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

export function ChannelCardMeta({
  channel,
  stats,
  inScopeCount,
  show,
}: {
  channel: Channel
  stats: ChannelStats | undefined
  inScopeCount: number
  show: ChannelMetaVisibility
}) {
  const velocity = stats?.velocity ?? 0
  return (
    <div className="flex flex-wrap items-center gap-2 mb-5">
      <TgMetaChip size="card" className="uppercase tracking-wider">
        <span>{(stats?.count || 0).toLocaleString()} Posts</span>
        {inScopeCount > 0 && (
          <span className="text-app-ink/40">
            ({inScopeCount.toLocaleString()} in scope)
          </span>
        )}
      </TgMetaChip>
      {velocity > 0 && (
        <ChipWithTooltip
          tooltip={<p>Activity Rate (Posts per hour): {velocity.toFixed(3)}</p>}
        >
          <Activity size={10} className="opacity-50" />
          <span>{velocity < 1 ? "< 1" : Math.round(velocity)} / hr</span>
        </ChipWithTooltip>
      )}

      {show.subscribers && channel.subscribers != null && (
        <Counter label="Subscribers" Icon={Users} value={channel.subscribers} />
      )}
      {show.telegramChatId && channel.telegramChatId != null && (
        <ChipWithTooltip
          className="tracking-wider cursor-help font-mono"
          tooltip={<p>Telegram chat ID</p>}
        >
          <span>{channel.telegramChatId}</span>
        </ChipWithTooltip>
      )}
      {COUNTERS.map(({ key, label, Icon }) => {
        const value = channel[key]
        return show[key] && value != null ? (
          <Counter key={key} label={label} Icon={Icon} value={value} />
        ) : null
      })}

      <TgMetaChip size="card" className="uppercase tracking-wider">
        <Clock size={10} className="opacity-50" />
        <RelativeTime timestamp={channel.lastUpdated} />
      </TgMetaChip>
      {channel.followedAt && (
        <ChipWithTooltip
          tooltip={
            <p>Followed on {new Date(channel.followedAt).toLocaleString()}</p>
          }
        >
          <span>
            Followed: {new Date(channel.followedAt).toLocaleDateString()}
          </span>
        </ChipWithTooltip>
      )}
      {channel.discoveredVia && (
        <Tooltip>
          <TooltipTrigger asChild>
            <TgMetaChip
              size="card"
              className="uppercase tracking-wider cursor-help bg-blue-500/10 text-blue-600"
            >
              <span>Auto-Followed</span>
            </TgMetaChip>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[200px] text-center">
            <p>
              Discovered via a forwarded post in{" "}
              <strong>@{channel.discoveredVia.channelName}</strong>
            </p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

function Counter({
  label,
  Icon,
  value,
}: {
  label: string
  Icon: LucideIcon
  value: number
}) {
  return (
    <ChipWithTooltip tooltip={<p>{label}</p>}>
      <Icon size={10} className="opacity-50" />
      <span>{formatCount(value)}</span>
    </ChipWithTooltip>
  )
}
