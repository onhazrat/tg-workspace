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
  Share2,
  Snowflake,
  Trash2,
  Users,
  Video,
  X,
} from "lucide-react"
import { motion } from "motion/react"
import type React from "react"
import { useEffect, useState } from "react"
import { api } from "@/api"
import {
  addManualTag,
  normalizeChannelTags,
  removeTagsByName,
} from "@/lib/channels/channel-tag-model"
import { useData } from "../contexts/DataContext"
import { useScraper } from "../contexts/ScraperContext"
import { useSettings } from "../contexts/SettingsContext"
import { useUI } from "../contexts/UIContext"
import { upsertChannel } from "../lib/repository"
import type { Channel } from "../types"
import { ChannelAvatar } from "./ChannelAvatar"
import { RelativeTime } from "./RelativeTime"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tg-tooltip"

interface ChannelCardProps {
  channel: Channel
  handleRemoveChannel: (channel: Channel) => void
  handleResetAndSync: (channel: Channel) => void
}

export const ChannelCard: React.FC<ChannelCardProps> = ({
  channel,
  handleRemoveChannel,
  handleResetAndSync,
}) => {
  const {
    channelStats,
    selectedChannels,
    setSelectedChannels,
    setChannels,
    loadChannels,
  } = useData()
  const { scrapingChannels, syncQueue, filteredPosts, addToSyncQueue } =
    useScraper()
  const { summarizing } = useUI()
  const {
    showChannelBio,
    showChannelSubscribers,
    showChannelPhotos,
    showChannelVideos,
    showChannelFiles,
    showChannelLinks,
    showChannelStartId,
  } = useSettings()

  const [isAddingTag, setIsAddingTag] = useState<boolean>(false)
  const [editingStartId, setEditingStartId] = useState<string | null>(null)
  const [regularIntervalInput, setRegularIntervalInput] = useState(
    String(channel.autoSyncIntervalMinutes ?? 60),
  )
  const [dynamicExpectedInput, setDynamicExpectedInput] = useState(
    String(channel.dynamicSyncExpectedPosts ?? 15),
  )

  const stats = channelStats[channel.name]
  const isScraping = scrapingChannels.has(channel.name)
  const inScopeCount = filteredPosts.filter(
    (p) => p.channelName === channel.name,
  ).length
  const syncQueueIndex = syncQueue.findIndex(
    (item) => item.channel.id === channel.id,
  )
  const isEditing = editingStartId !== null
  const isSelected = selectedChannels.has(channel.name)

  useEffect(() => {
    setRegularIntervalInput(String(channel.autoSyncIntervalMinutes ?? 60))
  }, [channel.autoSyncIntervalMinutes])

  useEffect(() => {
    setDynamicExpectedInput(String(channel.dynamicSyncExpectedPosts ?? 15))
  }, [channel.dynamicSyncExpectedPosts])

  const toggleChannelSelection = () => {
    if (channel.isFrozen) return
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
    const groups = await api.listSettingGroups()
    const targetGroup = channel.isFrozen
      ? groups.find((group) => group.isDefault)
      : groups.find((group) => group.name === "Frozen")
    if (!targetGroup) return
    await api.bulkAssignSettingGroup({
      channelIds: [channel.id],
      settingGroupId: targetGroup.id,
    })
    await loadChannels()
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
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleToggleFreeze()
                }}
                className={`w-8 h-8 rounded-full bg-app-bg/90 backdrop-blur-sm border border-app-ink/10 flex items-center justify-center transition-colors shadow-sm ${
                  channel.isFrozen
                    ? "text-blue-500 hover:bg-blue-500 hover:text-white hover:border-blue-500"
                    : "text-app-ink/70 hover:bg-app-ink hover:text-app-bg"
                }`}
              >
                <Snowflake size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                {channel.isFrozen
                  ? "Unfreeze Channel"
                  : "Freeze Channel (Stop Syncing)"}
              </p>
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleResetAndSync(channel)
              }}
              disabled={
                isScraping ||
                summarizing ||
                channel.isFrozen ||
                channel.isUnavailableOnWebView
              }
              className="w-8 h-8 rounded-full bg-app-bg/90 backdrop-blur-sm border border-app-ink/10 flex items-center justify-center text-app-ink/70 hover:bg-app-ink hover:text-app-bg transition-colors shadow-sm disabled:opacity-50"
            >
              <RotateCcw size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Reset & Sync from beginning</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleRemoveChannel(channel)
              }}
              className="w-8 h-8 rounded-full bg-app-bg/90 backdrop-blur-sm border border-app-ink/10 flex items-center justify-center text-red-500/70 hover:bg-red-500 hover:text-white hover:border-red-500 transition-colors shadow-sm"
            >
              <Trash2 size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Delete Channel</p>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Selection Indicator & Sync Queue Badge */}
      <div className="absolute top-4 left-4 flex items-center gap-2 z-20">
        <button
          type="button"
          onClick={toggleChannelSelection}
          disabled={channel.isFrozen}
          aria-label={
            isSelected ? `Deselect ${channel.name}` : `Select ${channel.name}`
          }
          aria-pressed={isSelected}
          className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
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
                  href={`https://t.me/s/${channel.name}`}
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
            <h4 className="font-bold text-lg leading-tight truncate mb-1 text-app-ink flex items-center gap-2">
              {channel.displayName || channel.name}
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
            {channel.settingGroupName && (
              <p className="text-[9px] uppercase tracking-widest text-app-ink/45 mt-1">
                Group: {channel.settingGroupName}
              </p>
            )}
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
          <div className="bg-app-muted px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider text-app-ink/75 flex items-center gap-1.5 border border-app-ink/5">
            <span>{(stats?.count || 0).toLocaleString()} Posts</span>
            {inScopeCount > 0 && (
              <span className="text-app-ink/40">
                ({inScopeCount.toLocaleString()} in scope)
              </span>
            )}
          </div>
          {stats?.velocity !== undefined && stats.velocity > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="bg-app-muted px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider text-app-ink/75 flex items-center gap-1.5 border border-app-ink/5 cursor-help">
                  <Activity size={10} className="opacity-50" />
                  <span>
                    {stats.velocity < 1 ? "< 1" : Math.round(stats.velocity)} /
                    hr
                  </span>
                </div>
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
                <div className="bg-app-muted px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider text-app-ink/75 flex items-center gap-1.5 border border-app-ink/5 cursor-help">
                  <Users size={10} className="opacity-50" />
                  <span>{channel.subscribers}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Subscribers</p>
              </TooltipContent>
            </Tooltip>
          )}
          {showChannelPhotos && channel.photos && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="bg-app-muted px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider text-app-ink/75 flex items-center gap-1.5 border border-app-ink/5 cursor-help">
                  <ImageIcon size={10} className="opacity-50" />
                  <span>{channel.photos}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Photos</p>
              </TooltipContent>
            </Tooltip>
          )}
          {showChannelVideos && channel.videos && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="bg-app-muted px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider text-app-ink/75 flex items-center gap-1.5 border border-app-ink/5 cursor-help">
                  <Video size={10} className="opacity-50" />
                  <span>{channel.videos}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Videos</p>
              </TooltipContent>
            </Tooltip>
          )}
          {showChannelFiles && channel.files && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="bg-app-muted px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider text-app-ink/75 flex items-center gap-1.5 border border-app-ink/5 cursor-help">
                  <File size={10} className="opacity-50" />
                  <span>{channel.files}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Files</p>
              </TooltipContent>
            </Tooltip>
          )}
          {showChannelLinks && channel.links && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="bg-app-muted px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider text-app-ink/75 flex items-center gap-1.5 border border-app-ink/5 cursor-help">
                  <LinkIcon size={10} className="opacity-50" />
                  <span>{channel.links}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Links</p>
              </TooltipContent>
            </Tooltip>
          )}

          <div className="bg-app-muted px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider text-app-ink/75 flex items-center gap-1.5 border border-app-ink/5">
            <Clock size={10} className="opacity-50" />
            <RelativeTime timestamp={channel.lastUpdated} />
          </div>
          {channel.followedAt && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="bg-app-muted px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider text-app-ink/75 flex items-center gap-1.5 border border-app-ink/5 cursor-help">
                  <span>
                    Followed:{" "}
                    {new Date(channel.followedAt).toLocaleDateString()}
                  </span>
                </div>
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
                <div className="bg-blue-500/10 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider text-blue-600 flex items-center gap-1.5 border border-blue-500/20 cursor-help">
                  <span>Auto-Followed</span>
                </div>
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
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className="group/regular-sync opacity-80"
                  onClick={(e) => e.stopPropagation()}
                  title={inheritedSettingsHint}
                >
                  <p className="text-[10px] uppercase text-app-ink/60 font-bold tracking-widest mb-0.5">
                    Regular
                  </p>
                  <div className="flex items-center gap-2 pointer-events-none">
                    <button
                      type="button"
                      disabled
                      className={`w-10 h-5 transition-all relative border border-app-ink/20 rounded-full ${
                        (channel.regularSyncEnabled ?? true)
                          ? "bg-green-500 border-green-600"
                          : "bg-app-ink/10"
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 w-3.5 h-3.5 bg-white transition-all rounded-full ${
                          (channel.regularSyncEnabled ?? true)
                            ? "left-5.5"
                            : "left-0.5"
                        }`}
                      />
                    </button>
                    <input
                      type="number"
                      readOnly
                      value={regularIntervalInput}
                      className="w-14 bg-app-bg border border-app-ink/20 px-1.5 py-0.5 text-[10px] font-mono"
                    />
                    <span className="text-[9px] uppercase font-bold text-app-ink/50">
                      min
                    </span>
                  </div>
                  <p className="text-[9px] text-app-ink/50 mt-1">
                    Next:{" "}
                    {channel.nextRegularSyncAt ? (
                      <RelativeTime timestamp={channel.nextRegularSyncAt} />
                    ) : (
                      "not scheduled"
                    )}
                  </p>
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-[240px] text-center">
                <p>{inheritedSettingsHint}</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className="group/dynamic-sync opacity-80"
                  onClick={(e) => e.stopPropagation()}
                  title={inheritedSettingsHint}
                >
                  <p className="text-[10px] uppercase text-app-ink/60 font-bold tracking-widest mb-0.5">
                    Dynamic
                  </p>
                  <div className="flex items-center gap-2 pointer-events-none">
                    <button
                      type="button"
                      disabled
                      className={`w-10 h-5 transition-all relative border border-app-ink/20 rounded-full ${
                        channel.dynamicSyncEnabled
                          ? "bg-blue-500 border-blue-600"
                          : "bg-app-ink/10"
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 w-3.5 h-3.5 bg-white transition-all rounded-full ${
                          channel.dynamicSyncEnabled ? "left-5.5" : "left-0.5"
                        }`}
                      />
                    </button>
                    <input
                      type="number"
                      readOnly
                      value={dynamicExpectedInput}
                      className="w-14 bg-app-bg border border-app-ink/20 px-1.5 py-0.5 text-[10px] font-mono"
                    />
                    <span className="text-[9px] uppercase font-bold text-app-ink/50">
                      posts
                    </span>
                  </div>
                  <p className="text-[9px] text-app-ink/50 mt-1">
                    Next:{" "}
                    {channel.nextDynamicSyncAt ? (
                      <RelativeTime timestamp={channel.nextDynamicSyncAt} />
                    ) : (
                      "not scheduled"
                    )}
                  </p>
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-[240px] text-center">
                <p>{inheritedSettingsHint}</p>
              </TooltipContent>
            </Tooltip>

            <div
              className="group/auto-follow opacity-80"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-[10px] uppercase text-app-ink/60 font-bold tracking-widest mb-0.5 flex items-center gap-1">
                <Share2 size={9} className="opacity-50" />
                Auto-Follow
              </p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled
                    className={`w-10 h-5 transition-all relative border border-app-ink/20 rounded-full pointer-events-none ${
                      channel.autoFollowForwarded
                        ? "bg-green-500 border-green-600"
                        : "bg-app-ink/10"
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 w-3.5 h-3.5 bg-white transition-all rounded-full ${
                        channel.autoFollowForwarded ? "left-5.5" : "left-0.5"
                      }`}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  className="max-w-[220px] text-center"
                >
                  <p>{inheritedSettingsHint}</p>
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
                disabled={isScraping || summarizing || channel.isFrozen}
                className="h-8 px-3 text-[10px] uppercase font-bold flex items-center justify-center gap-1.5 bg-app-ink/5 hover:bg-app-ink text-app-ink hover:text-app-bg transition-all disabled:opacity-30 rounded-lg border border-app-ink/10 hover:border-app-ink"
              >
                <RefreshCw
                  size={12}
                  className={isScraping ? "animate-spin" : ""}
                />
                Sync
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                {channel.isFrozen
                  ? "Channel is frozen"
                  : "Manual sync resets auto-sync timers"}
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
