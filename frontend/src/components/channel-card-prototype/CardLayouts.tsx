// PROTOTYPE: E, the card and the detailed card redrawn as stat tiles, with
// all of D's behaviour (token-field tags, coloured sync age, photo viewer,
// keyboard shortcuts). F and G lost. Never merge.
import type { ReactNode } from "react"
import type { ChannelMetaVisibility } from "@/lib/channels/card-zoom"
import { formatCount } from "@/lib/format-count"
import type { Channel, ChannelStats } from "@/types"
import {
  ChannelCardActions,
  ChannelCardBadges,
  ChannelCardSyncingOverlay,
} from "../channel-card/ChannelCardChrome"
import type { ChannelCardFaceProps } from "../channel-card/ChannelCardFace"
import { StartIdField, SyncButton } from "../channel-card/ChannelCardFooter"
import {
  ChannelBio,
  ChannelCardHeader,
} from "../channel-card/ChannelCardHeader"
import { ChannelCardTags } from "../channel-card/ChannelCardTags"
import {
  channelCardFrameClass,
  settingGroupHints,
  syncProgress,
} from "../channel-card/channel-card-status"
import {
  CHANNEL_SHORTCUTS,
  KBD_RING,
} from "../channel-grid/ChannelGridKeyboard"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tg-tooltip"
import { CardSyncStatus } from "./Freshness"
import type { CardVariant } from "./shared"

type Alt = "E"

export const isAltLayout = (v: CardVariant): v is Alt => v === "E"

/**
 * E's card spans six rows of its grid row and shares them as a subgrid, so
 * header, bio, tiles, tags, About and footer line up across the row. The
 * gap is the card's own: a subgrid would otherwise inherit the row's.
 */
const E_SUBGRID = "row-span-6 grid grid-rows-subgrid gap-y-0"

/** One number the card can show, with its label and what it means. */
type Fact = { key: string; label: string; value: string; hint: string }

/**
 * Everything the meta chips said, as plain facts, so each layout can draw
 * them its own way. The settings still decide which optional ones appear.
 */
function cardFacts(
  channel: Channel,
  stats: ChannelStats | undefined,
  inScope: number,
  show: ChannelMetaVisibility,
) {
  const velocity = stats?.velocity ?? 0
  const primary: Fact[] = [
    {
      key: "posts",
      label: "Posts",
      value: formatCount(stats?.count ?? 0),
      hint: `${(stats?.count ?? 0).toLocaleString()} posts stored`,
    },
    {
      key: "scope",
      label: "In scope",
      value: formatCount(inScope),
      hint: `${inScope.toLocaleString()} of this channel's posts are in the current scope`,
    },
    {
      key: "reach",
      label: "Reach",
      value:
        stats?.reach == null
          ? "—"
          : `${stats.reachEstimated ? "~" : ""}${formatCount(stats.reach)}`,
      hint:
        stats?.reach == null
          ? "Reach not measured: fewer than five recent Posts old enough to count."
          : "Median View count of recent Posts once they settled.",
    },
    {
      key: "rate",
      label: "Per hour",
      value:
        velocity <= 0 ? "—" : velocity < 1 ? "<1" : `${Math.round(velocity)}`,
      hint: `Posts per hour: ${velocity.toFixed(3)}`,
    },
  ]
  // A fact the settings turn on is always drawn, as "—" when the channel
  // has no value, so every card in a row has the same slots.
  if (show.subscribers)
    primary.push({
      key: "subs",
      label: "Subscribers",
      value:
        channel.subscribers == null ? "—" : formatCount(channel.subscribers),
      hint:
        channel.subscribers == null
          ? "Subscribers not known"
          : `${channel.subscribers.toLocaleString()} subscribers`,
    })
  const media: Fact[] = (
    [
      ["photos", "Photos"],
      ["videos", "Videos"],
      ["files", "Files"],
      ["links", "Links"],
    ] as const
  )
    .filter(([key]) => show[key])
    .map(([key, label]) => ({
      key,
      label,
      value: channel[key] == null ? "—" : formatCount(channel[key] ?? 0),
      hint: `${(channel[key] ?? 0).toLocaleString()} ${label.toLowerCase()}`,
    }))
  const about: Fact[] = []
  if (show.telegramChatId && channel.telegramChatId != null)
    about.push({
      key: "chat",
      label: "Chat ID",
      value: String(channel.telegramChatId),
      hint: "Telegram chat ID",
    })
  if (channel.followedAt)
    about.push({
      key: "followed",
      label: "Followed",
      value: new Date(channel.followedAt).toLocaleDateString(),
      hint: `Followed on ${new Date(channel.followedAt).toLocaleString()}`,
    })
  if (channel.discoveredVia)
    about.push({
      key: "via",
      label: "Auto-followed via",
      value: `@${channel.discoveredVia.channelName}`,
      hint: "Discovered via a forwarded post",
    })
  return { primary, media, about }
}

function Hint({ text, children }: { text: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>
        <p>{text}</p>
      </TooltipContent>
    </Tooltip>
  )
}

export function AltCardLayout({
  variant,
  ...p
}: ChannelCardFaceProps & { variant: Alt }) {
  const { virtualGroupTagName, inheritedSettingsHint } = settingGroupHints(
    p.channel.settingGroupName,
  )
  const facts = cardFacts(
    p.channel,
    p.stats,
    p.inScopeCount,
    p.face.meta ?? {
      subscribers: false,
      telegramChatId: false,
      photos: false,
      videos: false,
      files: false,
      links: false,
    },
  )
  const tags = (
    <ChannelCardTags
      tags={p.channel.tags}
      virtualGroupTagName={virtualGroupTagName}
      inheritedSettingsHint={inheritedSettingsHint}
      onSave={(tags) => p.onSaveChannel({ tags })}
    />
  )
  const sync = (
    <SyncButton
      channel={p.channel}
      busy={p.busy}
      isScraping={p.isScraping}
      onSync={p.onSync}
    />
  )
  const saveStartId = (startId: number) => p.onSaveChannel({ startId })
  const Body = StatTiles
  return (
    <div
      data-channel-name={p.channel.name}
      data-kbd-selected={p.keyboardRing ? "" : undefined}
      className={`${
        variant === "E"
          ? channelCardFrameClass({
              isFrozen: p.channel.isFrozen,
              isSelected: p.isSelected,
              isScraping: p.isScraping,
            }).replace("flex flex-col", E_SUBGRID)
          : channelCardFrameClass({
              isFrozen: p.channel.isFrozen,
              isSelected: p.isSelected,
              isScraping: p.isScraping,
            })
      } ${KBD_RING}`}
    >
      {p.isScraping && (
        <ChannelCardSyncingOverlay
          progress={syncProgress(p.stats)}
          clickThrough={false}
        />
      )}
      <ChannelCardActions
        channel={p.channel}
        busy={p.busy}
        onToggleFreeze={p.onToggleFreeze}
        onResetAndSync={p.onResetAndSync}
        onRemove={p.onRemove}
      />
      <ChannelCardBadges
        channel={p.channel}
        isSelected={p.isSelected}
        onToggleSelected={p.onToggleSelected}
        queuePosition={p.queuePosition}
        sortRank={p.sortRank}
        showCheckbox
        showDetails
      />
      <Body
        {...p}
        facts={facts}
        tags={tags}
        sync={sync}
        saveStartId={saveStartId}
      />
    </div>
  )
}

type BodyProps = ChannelCardFaceProps & {
  facts: ReturnType<typeof cardFacts>
  tags: ReactNode
  sync: ReactNode
  saveStartId: (startId: number) => void
}

const _avatarProps = {
  viewable: true,
  viewShortcut: CHANNEL_SHORTCUTS.photo,
} as const

/**
 * E: numbers first. The chips become a grid of stat tiles, big number over
 * a small label, so a row of cards can be compared by eye. The detailed card
 * adds tiles for media and a Sync section with both schedules.
 */
function StatTiles(p: BodyProps) {
  const tile = (f: Fact) => (
    <Hint key={f.key} text={f.hint}>
      <div className="rounded-lg bg-app-ink/[0.03] px-2 py-1.5 ring-1 ring-app-ink/5">
        <p className="truncate text-sm font-bold tabular-nums text-app-ink">
          {f.value}
        </p>
        <p className="text-[9px] uppercase tracking-wider text-app-ink/45">
          {f.label}
        </p>
      </div>
    </Hint>
  )
  const tiles = p.face.detailed
    ? [...p.facts.primary, ...p.facts.media]
    : p.facts.primary
  // Six tracks shared with every card in the row (see E_SUBGRID), so each
  // section starts where its neighbours' does. An absent bio or About line
  // is an empty track, not a missing one.
  return (
    <div className={`${E_SUBGRID} p-5 pt-12`}>
      {/* D's header, photo and title at D's size; its bio is the next track,
          so it lines up across the row. */}
      <div>
        <ChannelCardHeader channel={p.channel} showBio={false} linkToTelegram />
      </div>
      <div>
        {p.face.bio && p.channel.bio && (
          <ChannelBio bio={p.channel.bio} full={p.face.detailed} />
        )}
      </div>
      <div className="mb-4 grid grid-cols-3 content-start gap-1.5">
        {tiles.map(tile)}
      </div>
      <div>{p.tags}</div>
      <div>
        {p.face.detailed && p.facts.about.length > 0 && (
          <p className="-mt-2 mb-3 text-[10px] text-app-ink/50">
            {p.facts.about.map((f) => `${f.label} ${f.value}`).join(" · ")}
          </p>
        )}
      </div>
      <div className="flex items-end justify-between gap-3 self-end border-t border-app-ink/5 pt-3">
        <CardSyncStatus
          channel={p.channel}
          stats={p.stats}
          detailed={p.face.detailed}
        />
        <div className="flex items-end gap-3">
          {p.face.startId && (
            <StartIdField startId={p.channel.startId} onSave={p.saveStartId} />
          )}
          {p.sync}
        </div>
      </div>
    </div>
  )
}
