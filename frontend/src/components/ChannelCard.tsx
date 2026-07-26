import {
  Activity,
  Check,
  Clock,
  Edit2,
  ExternalLink,
  File,
  Image as ImageIcon,
  Link as LinkIcon,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Snowflake,
  Trash2,
  Users,
  Video,
  X,
} from "lucide-react"
import { motion } from "motion/react"
import type React from "react"
import { useState } from "react"
import { toast } from "sonner"
import { api } from "@/api"
import {
  useInvalidateSettingGroups,
  useSettingGroupsQuery,
} from "@/hooks/useSettingGroups"
import {
  addManualTag,
  normalizeChannelTags,
  removeTagsByName,
} from "@/lib/channels/channel-tag-model"
import { findFrozenReservedGroup } from "@/lib/channels/setting-groups"
import { channelAllows, disabledReason } from "@/lib/channels/sync-permissions"
import {
  syncScheduleDetail,
  syncScheduleSummary,
} from "@/lib/channels/sync-schedule-summary"
import {
  isVirtualGroupTag,
  toVirtualGroupTagName,
} from "@/lib/channels/virtual-group-tags"
import { telegramWebViewChannelUrl } from "@/lib/telegram-web"
import { useData } from "../contexts/DataContext"
import { useScraper } from "../contexts/ScraperContext"
import { useSettings } from "../contexts/SettingsContext"
import { useUI } from "../contexts/UIContext"
import { upsertChannel } from "../lib/repository"
import type { Channel } from "../types"
import { ChannelAvatar } from "./ChannelAvatar"
import { RelativeTime } from "./RelativeTime"
import { TgMetaChip } from "./ui/tg-chips"
import { TgIconButton } from "./ui/tg-icon-button"
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
  const {
    showChannelBio,
    showChannelSubscribers,
    showChannelTelegramChatId,
    showChannelPhotos,
    showChannelVideos,
    showChannelFiles,
    showChannelLinks,
    showChannelStartId,
  } = useSettings()
  const { data: settingGroups = [] } = useSettingGroupsQuery()
  const invalidateSettingGroups = useInvalidateSettingGroups()

  const [isAddingTag, setIsAddingTag] = useState<boolean>(false)
  const [editingStartId, setEditingStartId] = useState<string | null>(null)

  const stats = channelStats[channel.name]
  const isScraping = scrapingChannels.has(channel.name)
  const syncQueueIndex = syncQueue.findIndex(
    (item) => item.channel.id === channel.id,
  )
  const isEditing = editingStartId !== null
  const isSelected = selectedChannels.has(channel.name)
  const virtualGroupTagName = channel.settingGroupName
    ? toVirtualGroupTagName(channel.settingGroupName)
    : null

  const toggleChannelSelection = () => {
    setSelectedChannels((prev) => {
      const next = new Set(prev)
      if (next.has(channel.name)) {
        next.delete(channel.name)
      } else {
        next.add(channel.name)
      }
      return next
    })
  }

  const handleAddTag = async (tag: string) => {
    if (!tag.trim()) {
      setIsAddingTag(false)
      return
    }
    if (isVirtualGroupTag(tag)) {
      toast.error('Tags starting with "group:" are reserved for setting groups')
      setIsAddingTag(false)
      return
    }
    const newTags = addManualTag(channel.tags, tag.trim())
    const updatedChannel = { ...channel, tags: newTags }
    await upsertChannel(updatedChannel)
    setChannels((prev) =>
      prev.map((c) => (c.id === channel.id ? updatedChannel : c)),
    )
    setIsAddingTag(false)
  }

  const handleRemoveTag = async (tagToRemove: string) => {
    const newTags = removeTagsByName(channel.tags, [tagToRemove])
    const updatedChannel = { ...channel, tags: newTags }
    await upsertChannel(updatedChannel)
    setChannels((prev) =>
      prev.map((c) => (c.id === channel.id ? updatedChannel : c)),
    )
  }

  const handleUpdateStartId = async (newStartIdStr: string) => {
    const newStartId = parseInt(newStartIdStr, 10)
    if (!Number.isNaN(newStartId) && newStartId > 0) {
      const updatedChannel = { ...channel, startId: newStartId }
      await upsertChannel(updatedChannel)
      setChannels((prev) =>
        prev.map((c) => (c.id === channel.id ? updatedChannel : c)),
      )
    }
    setEditingStartId(null)
  }

  const handleToggleFreeze = async () => {
    if (channel.isUnavailableOnWebView) return
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
    if (!channel.isFrozen) {
      setSelectedChannels((prev) => {
        const next = new Set(prev)
        next.delete(channel.name)
        return next
      })
    }
  }

  const inheritedSettingsHint = channel.settingGroupName
    ? `Inherited from setting group "${channel.settingGroupName}"`
    : "Inherited from channel setting group"
  const channelTitle = channel.displayName || channel.name
  const nextSyncSummary = syncScheduleSummary(channel)
  const nextSyncDetail = syncScheduleDetail(channel)

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
      {/* Syncing Overlay */}
      {isScraping && (
        <div className="absolute inset-0 bg-app-bg/60 backdrop-blur-[2px] flex items-center justify-center z-30">
          <div className="flex flex-col items-center gap-3 w-full px-8">
            <div className="relative">
              <Loader2
                size={32}
                className="animate-spin text-app-ink opacity-80"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-1.5 h-1.5 bg-app-ink rounded-full animate-pulse" />
              </div>
            </div>
            <div className="flex flex-col items-center gap-1.5 w-full">
              <span className="text-[10px] uppercase font-bold tracking-widest text-app-ink bg-app-bg/80 px-3 py-1 rounded-full shadow-sm">
                {stats?.latestId && stats.maxId
                  ? `Syncing ${Math.round((stats.maxId / stats.latestId) * 100)}%`
                  : "Syncing Data"}
              </span>
              {stats?.latestId && stats.maxId && (
                <div className="w-full max-w-[120px] h-1 bg-app-ink/10 rounded-full overflow-hidden mt-1">
                  <motion.div
                    className="h-full bg-app-ink"
                    initial={{ width: 0 }}
                    animate={{
                      width: `${Math.min(100, (stats.maxId / stats.latestId) * 100)}%`,
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Hidden Hover Action Bar (Destructive Actions) */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity z-20">
        {!channel.isUnavailableOnWebView && (
          <TgIconButton
            variant="frosted"
            aria-label={
              channel.isFrozen
                ? "Unfreeze Channel"
                : "Freeze Channel (Stop Syncing)"
            }
            tooltip={
              channel.isFrozen
                ? "Unfreeze Channel"
                : "Freeze Channel (Stop Syncing)"
            }
            onClick={(e) => {
              e.stopPropagation()
              handleToggleFreeze()
            }}
            className={
              channel.isFrozen
                ? "text-blue-500 hover:bg-blue-500 hover:text-white"
                : undefined
            }
          >
            <Snowflake size={14} />
          </TgIconButton>
        )}
        <TgIconButton
          variant="frosted"
          aria-label={
            disabledReason(channel, "reset") ?? "Reset & Sync from beginning"
          }
          tooltip={
            disabledReason(channel, "reset") ?? "Reset & Sync from beginning"
          }
          onClick={(e) => {
            e.stopPropagation()
            handleResetAndSync(channel)
          }}
          disabled={
            isScraping || summarizing || !channelAllows(channel, "reset")
          }
        >
          <RotateCcw size={14} />
        </TgIconButton>
        <TgIconButton
          variant="frosted"
          aria-label="Delete Channel"
          tooltip="Delete Channel"
          onClick={(e) => {
            e.stopPropagation()
            handleRemoveChannel(channel)
          }}
          className="text-red-500/70 hover:bg-red-500 hover:text-white"
        >
          <Trash2 size={14} />
        </TgIconButton>
      </div>

      {/* Selection Indicator & Sync Queue Badge */}
      <div className="absolute top-4 left-4 flex items-center gap-2 z-20">
        <button
          type="button"
          onClick={toggleChannelSelection}
          aria-label={
            isSelected ? `Deselect ${channel.name}` : `Select ${channel.name}`
          }
          aria-pressed={isSelected}
          className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ink/30 ${
            isSelected
              ? "bg-app-ink border-app-ink text-app-bg"
              : "border-app-ink/20 bg-app-bg/50 text-transparent hover:border-app-ink/40"
          }`}
        >
          <Check size={12} strokeWidth={3} />
        </button>

        {syncQueueIndex !== -1 && (
          <div className="bg-app-ink text-app-bg text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
            <Clock size={10} />
            <span>#{syncQueueIndex + 1}</span>
          </div>
        )}

        {sortRank != null && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                data-testid="channel-sort-rank"
                className="bg-app-ink/5 text-app-ink/60 border border-app-ink/10 text-[9px] font-bold px-1.5 py-0.5 rounded-full tabular-nums shadow-sm cursor-help"
              >
                #{sortRank}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                Rank {sortRank} among selected channels by current sort order
                (Trim keeps ranks 1–N)
              </p>
            </TooltipContent>
          </Tooltip>
        )}

        {channel.isUnavailableOnWebView && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="bg-red-500/10 text-red-500 border border-red-500/20 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm cursor-help">
                <Activity size={10} />
                <span>Unavailable</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                This channel is not available on the web view and cannot be
                scraped.
              </p>
            </TooltipContent>
          </Tooltip>
        )}

        {channel.language && (
          <div className="bg-app-ink/5 text-app-ink/70 border border-app-ink/10 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
            <span>{channel.language}</span>
          </div>
        )}

        {channel.historyCompleteToCutoff === false && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="bg-amber-500/10 text-amber-700 border border-amber-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm cursor-help">
                <Clock size={10} />
                <span>Partial history</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>History does not reach retention window</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Card Content */}
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
        {showChannelBio && channel.bio && (
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

        {/* Metadata Badges */}
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <TgMetaChip size="card" className="uppercase tracking-wider">
            <span>{(stats?.count || 0).toLocaleString()} Posts</span>
            {inScopeCount > 0 && (
              <span className="text-app-ink/40">
                ({inScopeCount.toLocaleString()} in scope)
              </span>
            )}
          </TgMetaChip>
          {stats?.velocity !== undefined && stats.velocity > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <TgMetaChip
                  size="card"
                  className="uppercase tracking-wider cursor-help"
                >
                  <Activity size={10} className="opacity-50" />
                  <span>
                    {stats.velocity < 1 ? "< 1" : Math.round(stats.velocity)} /
                    hr
                  </span>
                </TgMetaChip>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  Activity Rate (Posts per hour): {stats.velocity.toFixed(3)}
                </p>
              </TooltipContent>
            </Tooltip>
          )}

          {/* New Metadata Badges */}
          {showChannelSubscribers && channel.subscribers && (
            <Tooltip>
              <TooltipTrigger asChild>
                <TgMetaChip
                  size="card"
                  className="uppercase tracking-wider cursor-help"
                >
                  <Users size={10} className="opacity-50" />
                  <span>{channel.subscribers}</span>
                </TgMetaChip>
              </TooltipTrigger>
              <TooltipContent>
                <p>Subscribers</p>
              </TooltipContent>
            </Tooltip>
          )}
          {showChannelTelegramChatId && channel.telegramChatId != null && (
            <Tooltip>
              <TooltipTrigger asChild>
                <TgMetaChip
                  size="card"
                  className="tracking-wider cursor-help font-mono"
                >
                  <span>{channel.telegramChatId}</span>
                </TgMetaChip>
              </TooltipTrigger>
              <TooltipContent>
                <p>Telegram chat ID</p>
              </TooltipContent>
            </Tooltip>
          )}
          {showChannelPhotos && channel.photos && (
            <Tooltip>
              <TooltipTrigger asChild>
                <TgMetaChip
                  size="card"
                  className="uppercase tracking-wider cursor-help"
                >
                  <ImageIcon size={10} className="opacity-50" />
                  <span>{channel.photos}</span>
                </TgMetaChip>
              </TooltipTrigger>
              <TooltipContent>
                <p>Photos</p>
              </TooltipContent>
            </Tooltip>
          )}
          {showChannelVideos && channel.videos && (
            <Tooltip>
              <TooltipTrigger asChild>
                <TgMetaChip
                  size="card"
                  className="uppercase tracking-wider cursor-help"
                >
                  <Video size={10} className="opacity-50" />
                  <span>{channel.videos}</span>
                </TgMetaChip>
              </TooltipTrigger>
              <TooltipContent>
                <p>Videos</p>
              </TooltipContent>
            </Tooltip>
          )}
          {showChannelFiles && channel.files && (
            <Tooltip>
              <TooltipTrigger asChild>
                <TgMetaChip
                  size="card"
                  className="uppercase tracking-wider cursor-help"
                >
                  <File size={10} className="opacity-50" />
                  <span>{channel.files}</span>
                </TgMetaChip>
              </TooltipTrigger>
              <TooltipContent>
                <p>Files</p>
              </TooltipContent>
            </Tooltip>
          )}
          {showChannelLinks && channel.links && (
            <Tooltip>
              <TooltipTrigger asChild>
                <TgMetaChip
                  size="card"
                  className="uppercase tracking-wider cursor-help"
                >
                  <LinkIcon size={10} className="opacity-50" />
                  <span>{channel.links}</span>
                </TgMetaChip>
              </TooltipTrigger>
              <TooltipContent>
                <p>Links</p>
              </TooltipContent>
            </Tooltip>
          )}

          <TgMetaChip size="card" className="uppercase tracking-wider">
            <Clock size={10} className="opacity-50" />
            <RelativeTime timestamp={channel.lastUpdated} />
          </TgMetaChip>
          {channel.followedAt && (
            <Tooltip>
              <TooltipTrigger asChild>
                <TgMetaChip
                  size="card"
                  className="uppercase tracking-wider cursor-help"
                >
                  <span>
                    Followed:{" "}
                    {new Date(channel.followedAt).toLocaleDateString()}
                  </span>
                </TgMetaChip>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  Followed on {new Date(channel.followedAt).toLocaleString()}
                </p>
              </TooltipContent>
            </Tooltip>
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
              <TooltipContent
                side="bottom"
                className="max-w-[200px] text-center"
              >
                <p>
                  Discovered via a forwarded post in{" "}
                  <strong>@{channel.discoveredVia.channelName}</strong>
                </p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Tags Section */}
        <div className="mb-5 flex flex-wrap gap-1.5">
          {virtualGroupTagName && (
            <span
              className="text-[10px] font-bold px-2 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-700 rounded-md"
              title={inheritedSettingsHint}
            >
              {virtualGroupTagName}
            </span>
          )}
          {normalizeChannelTags(channel.tags).map((tag) => (
            <span
              key={tag.name.toLowerCase()}
              className="text-[10px] font-bold px-2 py-1 bg-app-ink/5 border border-app-ink/10 flex items-center gap-1.5 group/tag rounded-md text-app-ink/80"
            >
              {tag.name}
              {tag.source === "ai" && (
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500/80" />
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleRemoveTag(tag.name)
                }}
                className="opacity-0 group-hover/tag:opacity-50 hover:!opacity-100 transition-opacity"
              >
                <X size={10} />
              </button>
            </span>
          ))}
          {isAddingTag ? (
            <input
              type="text"
              placeholder="Tag..."
              className="text-[10px] font-bold px-2 py-1 bg-app-bg border border-app-ink/20 focus:border-app-ink/40 focus:outline-none w-20 rounded-md shadow-inner"
              onBlur={(e) => handleAddTag((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  handleAddTag((e.target as HTMLInputElement).value)
                if (e.key === "Escape") setIsAddingTag(false)
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setIsAddingTag(true)
                  }}
                  className="text-[10px] uppercase font-bold px-2 py-1 border border-dashed border-app-ink/20 text-app-ink/60 hover:text-app-ink hover:border-solid hover:bg-app-ink/5 transition-all flex items-center gap-1 rounded-md"
                >
                  <Plus size={10} /> Add Tag
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Add a new tag to this channel</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Bottom Section: Config & Sync Action */}
        <div className="mt-auto flex items-center justify-between pt-4 border-t border-app-ink/5 gap-3">
          <div className="flex items-start gap-4 flex-wrap">
            {showChannelStartId && (
              <div className="group/config">
                <p className="text-[10px] uppercase text-app-ink/60 font-bold tracking-widest mb-0.5">
                  Start ID
                </p>
                {isEditing ? (
                  <input
                    type="text"
                    value={editingStartId}
                    onChange={(e) => setEditingStartId(e.target.value)}
                    onBlur={() => handleUpdateStartId(editingStartId)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleUpdateStartId(editingStartId)
                      if (e.key === "Escape") setEditingStartId(null)
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-16 bg-transparent text-sm font-bold leading-none focus:outline-none border-b border-app-ink/30"
                  />
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className="flex items-center gap-1.5 cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingStartId((channel.startId ?? "").toString())
                        }}
                      >
                        <p
                          className={`text-sm font-bold leading-none group-hover/config:text-app-ink/70 transition-colors ${channel.startId == null ? "text-amber-500" : ""}`}
                        >
                          {channel.startId == null
                            ? "Auto"
                            : channel.startId.toLocaleString()}
                        </p>
                        <Edit2
                          size={10}
                          className="opacity-0 group-hover/config:opacity-40 transition-opacity"
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>
                        {channel.startId == null
                          ? "Start ID will be resolved automatically on next sync"
                          : "Edit the starting post ID for syncing"}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            )}

            <div>
              <p className="text-[10px] uppercase text-app-ink/60 font-bold tracking-widest mb-0.5">
                Status
              </p>
              <div className="flex items-center gap-1.5">
                <div
                  className={`w-1.5 h-1.5 rounded-full ${
                    channel.isUnavailableOnWebView
                      ? "bg-red-500"
                      : channel.isFrozen
                        ? "bg-blue-500"
                        : stats?.maxId &&
                            stats?.latestId &&
                            stats.maxId >= stats.latestId
                          ? "bg-emerald-500"
                          : "bg-amber-500 animate-pulse"
                  }`}
                />
                <p className="text-[10px] font-bold uppercase tracking-tight text-app-ink/70">
                  {channel.isUnavailableOnWebView
                    ? "Restricted"
                    : channel.isFrozen
                      ? "Frozen"
                      : stats?.maxId &&
                          stats?.latestId &&
                          stats.maxId >= stats.latestId
                        ? "Up to date"
                        : "Pending"}
                </p>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="text-[9px] text-app-ink/50 mt-1 max-w-[220px] truncate cursor-help">
                    {nextSyncSummary}
                  </p>
                </TooltipTrigger>
                <TooltipContent className="max-w-[260px] text-center">
                  {/* The card face shows relative times; the exact schedule only
                      fits here. It used to be missing entirely — this tooltip
                      showed the inherited-group hint and nothing about sync. */}
                  <p>{nextSyncDetail}</p>
                  <p className="mt-1 opacity-70">{inheritedSettingsHint}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  addToSyncQueue(channel, "Manual (Single Sync)", () => {})
                }}
                disabled={
                  isScraping ||
                  summarizing ||
                  !channelAllows(channel, "individual")
                }
                className="h-8 px-3 text-[10px] uppercase font-bold flex items-center justify-center gap-1.5 bg-app-ink/5 hover:bg-app-ink text-app-ink hover:text-app-bg transition-all disabled:opacity-30 rounded-lg border border-app-ink/10 hover:border-app-ink"
              >
                <RefreshCw
                  size={12}
                  className={isScraping ? "animate-spin" : ""}
                />
                {channel.isUnavailableOnWebView ? "Recheck" : "Sync"}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                {disabledReason(channel, "individual") ??
                  "Manual sync resets auto-sync timers"}
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
