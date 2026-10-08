import type { StatTileKey } from "@/lib/channels/card-zoom"
import { formatCount } from "@/lib/format-count"
import type { Channel, ChannelStats } from "@/types"

/** One number a card shows: what it is, how it reads, and its exact value. */
interface Fact {
  label: string
  value: string
  hint: string
}

const DASH = "—"

const MEDIA_LABELS = {
  subscribers: "Subscribers",
  photos: "Photos",
  videos: "Videos",
  files: "Files",
  links: "Links",
} as const

/** A counter the Channel row carries, or a dash when it has none. */
function counter(label: string, value: number | null | undefined): Fact {
  return value == null
    ? { label, value: DASH, hint: `${label} not known` }
    : {
        label,
        value: formatCount(value),
        hint: `${value.toLocaleString()} ${label.toLowerCase()}`,
      }
}

/**
 * Reach keeps the chip's rules: a tilde when it was estimated from View
 * counts still climbing, a dash when too few Posts are old enough to count.
 */
function reachFact(stats: ChannelStats | undefined): Fact {
  const reach = stats?.reach
  if (reach == null)
    return {
      label: "Reach",
      value: DASH,
      hint: "Reach not measured: fewer than five recent Posts old enough to count.",
    }
  return stats?.reachEstimated
    ? {
        label: "Reach",
        value: `~${formatCount(reach)}`,
        hint:
          `Reach ~${reach.toLocaleString()}, estimated: too few recent Posts ` +
          "have settled, so younger View counts were corrected through the " +
          "Settling curve.",
      }
    : {
        label: "Reach",
        value: formatCount(reach),
        hint: `Reach ${reach.toLocaleString()}: the median View count of recent Posts once they settled.`,
      }
}

function perHourFact(velocity: number | undefined): Fact {
  if (velocity == null)
    return { label: "Per hour", value: DASH, hint: "Posting rate not known" }
  return {
    label: "Per hour",
    value:
      velocity > 0 && velocity < 1 ? "<1" : formatCount(Math.round(velocity)),
    hint: `${velocity.toFixed(3)} Posts per hour`,
  }
}

function fact(
  key: StatTileKey,
  channel: Channel,
  stats: ChannelStats | undefined,
  inScope: number | null,
): Fact {
  switch (key) {
    case "posts":
      return counter("Posts", stats?.count)
    case "inScope":
      return inScope == null
        ? { label: "In scope", value: DASH, hint: "In scope: not selected" }
        : {
            label: "In scope",
            value: formatCount(inScope),
            hint: `${inScope.toLocaleString()} Posts in the current Scope`,
          }
    case "reach":
      return reachFact(stats)
    case "perHour":
      return perHourFact(stats?.velocity)
    default:
      return counter(MEDIA_LABELS[key], channel[key])
  }
}

/**
 * The detailed card's About line: the chat id when the face shows it, the
 * date the Channel was followed, and the Channel it was auto-followed from,
 * each only when known. Nothing at all when none is.
 */
export function ChannelCardAbout({
  channel,
  showChatId,
}: {
  channel: Channel
  showChatId: boolean
}) {
  const parts: string[] = []
  if (showChatId && channel.telegramChatId != null)
    parts.push(`Chat ID ${channel.telegramChatId}`)
  if (channel.followedAt)
    parts.push(`Followed ${new Date(channel.followedAt).toLocaleDateString()}`)
  if (channel.discoveredVia)
    parts.push(`Auto-followed from @${channel.discoveredVia.channelName}`)
  if (parts.length === 0) return null
  return (
    <p data-card-about className="mb-4 text-[10px] text-app-ink/50">
      {parts.join(" · ")}
    </p>
  )
}

/**
 * The card's numbers as tiles, big number over a small label. Every key the
 * face lists is drawn, as a dash when the Channel has no value, so every card
 * in a row has the same tiles in the same places.
 */
export function ChannelCardStatTiles({
  keys,
  channel,
  stats,
  inScope,
}: {
  keys: StatTileKey[]
  channel: Channel
  stats: ChannelStats | undefined
  /** In-scope Post count, or null when the Channel is not selected. */
  inScope: number | null
}) {
  return (
    <div className="mb-4 grid grid-cols-3 content-start gap-1.5">
      {keys.map((key) => {
        const { label, value, hint } = fact(key, channel, stats, inScope)
        return (
          <div
            key={key}
            data-stat={key}
            title={hint}
            className="cursor-help rounded-lg bg-app-ink/[0.03] px-2 py-1.5 ring-1 ring-app-ink/5"
          >
            <p
              data-stat-value
              className="truncate text-sm font-bold tabular-nums text-app-ink"
            >
              {value}
            </p>
            <p
              data-stat-label
              className="truncate text-[9px] uppercase tracking-wider text-app-ink/45"
            >
              {label}
            </p>
          </div>
        )
      })}
    </div>
  )
}
