import type React from "react"
import { api } from "@/api"
import {
  useInvalidateSettingGroups,
  useSettingGroupsQuery,
} from "@/hooks/useSettingGroups"
import { upsertChannel } from "@/lib/channels/store"
import { useData } from "../contexts/DataContext"
import { useScraper } from "../contexts/ScraperContext"
import { useSettings } from "../contexts/SettingsContext"
import { useUI } from "../contexts/UIContext"
import type { Channel } from "../types"
import {
  ChannelCardActions,
  ChannelCardBadges,
  ChannelCardSyncingOverlay,
} from "./channel-card/ChannelCardChrome"
import { ChannelCardFooter } from "./channel-card/ChannelCardFooter"
import { ChannelCardHeader } from "./channel-card/ChannelCardHeader"
import { ChannelCardMeta } from "./channel-card/ChannelCardMeta"
import { ChannelCardTags } from "./channel-card/ChannelCardTags"
import {
  channelCardFrameClass,
  freezeTargetGroup,
  queuePosition,
  settingGroupHints,
  syncProgress,
} from "./channel-card/channel-card-status"

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
    const targetGroup = freezeTargetGroup(channel, settingGroups)
    if (!targetGroup) return
    await api.bulkAssignSettingGroup({
      channelIds: [channel.id],
      settingGroupId: targetGroup.id,
    })
    await loadChannels()
    await invalidateSettingGroups()
    if (!channel.isFrozen) setSelected(false)
  }

  const { virtualGroupTagName, inheritedSettingsHint } = settingGroupHints(
    channel.settingGroupName,
  )

  return (
    <div
      data-channel-name={channel.name}
      className={channelCardFrameClass({
        isFrozen: channel.isFrozen,
        isSelected,
        isScraping,
      })}
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
        queuePosition={queuePosition(syncQueue, channel.id)}
        sortRank={sortRank}
      />

      <div className="p-5 pt-12 flex flex-col h-full">
        <ChannelCardHeader
          channel={channel}
          showBio={settings.showChannelBio}
        />
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
          virtualGroupTagName={virtualGroupTagName}
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
