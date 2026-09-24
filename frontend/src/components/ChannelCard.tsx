import { ExternalLink, Snowflake } from "lucide-react"
import type React from "react"
import { api } from "@/api"
import {
  useInvalidateSettingGroups,
  useSettingGroupsQuery,
} from "@/hooks/useSettingGroups"
import { findFrozenReservedGroup } from "@/lib/channels/setting-groups"
import { upsertChannel } from "@/lib/channels/store"
import { toVirtualGroupTagName } from "@/lib/channels/virtual-group-tags"
import { telegramWebViewChannelUrl } from "@/lib/telegram-web"
import { useData } from "../contexts/DataContext"
import { useScraper } from "../contexts/ScraperContext"
import { useSettings } from "../contexts/SettingsContext"
import { useUI } from "../contexts/UIContext"
import type { Channel } from "../types"
import { ChannelAvatar } from "./ChannelAvatar"
import {
  ChannelCardActions,
  ChannelCardBadges,
  ChannelCardSyncingOverlay,
} from "./channel-card/ChannelCardChrome"
import { ChannelCardFooter } from "./channel-card/ChannelCardFooter"
import { ChannelCardMeta } from "./channel-card/ChannelCardMeta"
import { ChannelCardTags } from "./channel-card/ChannelCardTags"
import { syncProgress } from "./channel-card/channel-card-status"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tg-tooltip"

interface ChannelCardProps {
  channel: Channel
  /** In-scope post count for this channel, from the shared counts query. */
  inScopeCount: number
  handleRemoveChannel: (channel: Channel) => void
  handleResetAndSync: (channel: Channel) => void
  sortRank?: number
}

export const ChannelCard: React.FC<ChannelCardProps> = ({
  channel,
  inScopeCount,
  handleRemoveChannel,
  handleResetAndSync,
  sortRank,
}) => {
  const {
    channelStats,
    selectedChannels,
    setSelectedChannels,
    setChannels,
    loadChannels,
  } = useData()
  const { scrapingChannels, syncQueue, addToSyncQueue } = useScraper()
  const { summarizing } = useUI()
  const settings = useSettings()
  const { data: settingGroups = [] } = useSettingGroupsQuery()
  const invalidateSettingGroups = useInvalidateSettingGroups()

  const stats = channelStats[channel.name]
  const isScraping = scrapingChannels.has(channel.name)
  const busy = isScraping || summarizing
  const queueIndex = syncQueue.findIndex(
    (item) => item.channel.id === channel.id,
  )
  const isSelected = selectedChannels.has(channel.name)

  const setSelected = (selected: boolean) =>
    setSelectedChannels((prev) => {
      const next = new Set(prev)
      if (selected) next.add(channel.name)
      else next.delete(channel.name)
      return next
    })

  const saveChannel = async (patch: Partial<Channel>) => {
    const updatedChannel = { ...channel, ...patch }
    await upsertChannel(updatedChannel)
    setChannels((prev) =>
      prev.map((c) => (c.id === channel.id ? updatedChannel : c)),
    )
  }

  const handleToggleFreeze = async () => {
    const targetGroup = channel.isFrozen
      ? settingGroups.find((group) => group.isDefault)
      : findFrozenReservedGroup(settingGroups)
    if (!targetGroup) return
    await api.bulkAssignSettingGroup({
      channelIds: [channel.id],
      settingGroupId: targetGroup.id,
    })
    await loadChannels()
    await invalidateSettingGroups()
    if (!channel.isFrozen) setSelected(false)
  }

  const inheritedSettingsHint = channel.settingGroupName
    ? `Inherited from setting group "${channel.settingGroupName}"`
    : "Inherited from channel setting group"
  const channelTitle = channel.displayName || channel.name

  return (
    <div
      data-channel-name={channel.name}
      className={`relative flex flex-col h-full rounded-2xl border transition-all duration-200 overflow-hidden group
        ${channel.isFrozen ? "opacity-80" : ""}
        ${
          isSelected
            ? "bg-app-card border-app-ink shadow-md"
            : "bg-app-card border-app-ink/10 shadow-sm hover:border-app-ink/30 hover:shadow-md"
        }
        ${isScraping ? "ring-2 ring-app-ink/20" : ""}
      `}
    >
      {isScraping && (
        <ChannelCardSyncingOverlay progress={syncProgress(stats)} />
      )}

      <ChannelCardActions
        channel={channel}
        busy={busy}
        onToggleFreeze={handleToggleFreeze}
        onResetAndSync={() => handleResetAndSync(channel)}
        onRemove={() => handleRemoveChannel(channel)}
      />

      <ChannelCardBadges
        channel={channel}
        isSelected={isSelected}
        onToggleSelected={() => setSelected(!isSelected)}
        queuePosition={queueIndex === -1 ? null : queueIndex + 1}
        sortRank={sortRank}
      />

      <div className="p-5 pt-12 flex flex-col h-full">
        {/* Header Section */}
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

        {/* Bio Section */}
        {settings.showChannelBio && channel.bio && (
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
        <ChannelCardMeta
          channel={channel}
          stats={stats}
          inScopeCount={inScopeCount}
          show={{
            subscribers: settings.showChannelSubscribers,
            telegramChatId: settings.showChannelTelegramChatId,
            photos: settings.showChannelPhotos,
            videos: settings.showChannelVideos,
            files: settings.showChannelFiles,
            links: settings.showChannelLinks,
          }}
        />

        <ChannelCardTags
          tags={channel.tags}
          virtualGroupTagName={
            channel.settingGroupName
              ? toVirtualGroupTagName(channel.settingGroupName)
              : null
          }
          inheritedSettingsHint={inheritedSettingsHint}
          onSave={(tags) => saveChannel({ tags })}
        />

        <ChannelCardFooter
          channel={channel}
          stats={stats}
          showStartId={settings.showChannelStartId}
          isScraping={isScraping}
          busy={busy}
          inheritedSettingsHint={inheritedSettingsHint}
          onSaveStartId={(startId) => saveChannel({ startId })}
          onSync={() =>
            addToSyncQueue(channel, "Manual (Single Sync)", () => {})
          }
        />
      </div>
    </div>
  )
}
