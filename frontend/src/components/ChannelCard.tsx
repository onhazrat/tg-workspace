import type React from "react"
import { api } from "@/api"
import {
  useInvalidateSettingGroups,
  useSettingGroupsQuery,
} from "@/hooks/useSettingGroups"
import { cardFace } from "@/lib/channels/card-zoom"
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
import { ChannelCardTile } from "./channel-card/ChannelCardTile"
import {
  channelCardFrameClass,
  freezeTargetGroup,
  queuePosition,
  selectLabel,
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
  const face = cardFace(settings.channelCardZoom, settings)

  if (face.layout === "tile") {
    return (
      <ChannelCardTile
        channel={channel}
        isSelected={isSelected}
        isScraping={isScraping}
        onToggleSelected={() => setSelected(!isSelected)}
      />
    )
  }

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
        <ChannelCardSyncingOverlay
          progress={syncProgress(stats)}
          clickThrough={face.bodySelects}
        />
      )}

      {face.bodySelects && (
        // The whole card is the selection toggle. It sits under Sync rather
        // than around it, because a button may not hold a button.
        <button
          type="button"
          aria-pressed={isSelected}
          aria-label={selectLabel(channel.name, isSelected)}
          onClick={() => setSelected(!isSelected)}
          className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ink/30"
        />
      )}

      {face.hoverActions && (
        <ChannelCardActions
          channel={channel}
          busy={busy}
          onToggleFreeze={handleToggleFreeze}
          onResetAndSync={() => handleResetAndSync(channel)}
          onRemove={() => handleRemoveChannel(channel)}
        />
      )}

      <ChannelCardBadges
        channel={channel}
        isSelected={isSelected}
        onToggleSelected={() => setSelected(!isSelected)}
        queuePosition={queuePosition(syncQueue, channel.id)}
        sortRank={sortRank}
        showCheckbox={face.checkbox}
        showDetails={face.detailBadges}
      />

      <div
        className={`flex flex-col h-full ${face.bodySelects ? "p-4 pt-9" : "p-5 pt-12"}`}
      >
        <ChannelCardHeader
          channel={channel}
          showBio={face.bio}
          linkToTelegram={!face.bodySelects}
        />
        {face.meta && (
          <ChannelCardMeta
            channel={channel}
            stats={stats}
            inScopeCount={inScopeCount}
            show={face.meta}
          />
        )}

        {face.tags && (
          <ChannelCardTags
            tags={channel.tags}
            virtualGroupTagName={virtualGroupTagName}
            inheritedSettingsHint={inheritedSettingsHint}
            onSave={(tags) => saveChannel({ tags })}
          />
        )}

        <ChannelCardFooter
          channel={channel}
          stats={stats}
          showStartId={face.startId}
          showStatus={face.syncStatus}
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
