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
import { ChannelCardFace } from "./channel-card/ChannelCardFace"
import { ChannelCardTile } from "./channel-card/ChannelCardTile"
import {
  freezeTargetGroup,
  queuePosition,
} from "./channel-card/channel-card-status"

interface ChannelCardProps {
  channel: Channel
  /** In-scope post count for this channel, from the shared counts query. */
  inScopeCount: number
  /** Adds a tag funnel to the Channel filter; the grid owns the filter. */
  onFilterByTag: (tag: string) => void
  handleRemoveChannel: (channel: Channel) => void
  handleResetAndSync: (channel: Channel) => void
  /** One click on this card's selection control; the grid owns range select. */
  onSelectChannel: (name: string, shift: boolean) => void
  sortRank?: number
  /** Keyboard mode's highlight is on this card. */
  highlighted?: boolean
}

export const ChannelCard: React.FC<ChannelCardProps> = ({
  channel,
  inScopeCount,
  onFilterByTag,
  handleRemoveChannel,
  handleResetAndSync,
  onSelectChannel,
  sortRank,
  highlighted,
}) => {
  const {
    channels,
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

  const onToggleSelected = (shift: boolean) =>
    onSelectChannel(channel.name, shift)

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
    if (!channel.isFrozen)
      setSelectedChannels((prev) => {
        const next = new Set(prev)
        next.delete(channel.name)
        return next
      })
  }

  const sync = () => addToSyncQueue(channel, "Manual (Single Sync)", () => {})
  const face = cardFace(settings.channelCardZoom, settings)

  if (face.layout === "tile") {
    return (
      <ChannelCardTile
        channel={channel}
        isSelected={isSelected}
        isScraping={isScraping}
        busy={busy}
        highlighted={highlighted}
        onToggleSelected={onToggleSelected}
        onSync={sync}
      />
    )
  }

  return (
    <ChannelCardFace
      channel={channel}
      stats={stats}
      face={face}
      inScopeCount={inScopeCount}
      accountChannels={channels}
      onFilterByTag={onFilterByTag}
      isSelected={isSelected}
      isScraping={isScraping}
      busy={busy}
      queuePosition={queuePosition(syncQueue, channel.id)}
      sortRank={sortRank}
      highlighted={highlighted}
      onToggleSelected={onToggleSelected}
      onToggleFreeze={handleToggleFreeze}
      onResetAndSync={() => handleResetAndSync(channel)}
      onRemove={() => handleRemoveChannel(channel)}
      onSaveChannel={saveChannel}
      onSync={sync}
    />
  )
}
