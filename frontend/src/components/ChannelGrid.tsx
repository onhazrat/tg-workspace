import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { ShieldAlert, Database, Tag, RefreshCw, Send, ArrowDown, ArrowUp } from 'lucide-react';
import { Channel, NetworkLog } from '../types';
import { ChannelCard } from './ChannelCard';
import { useData } from '../contexts/DataContext';
import { useUI } from '../contexts/UIContext';
import { useSettings } from '../contexts/SettingsContext';
import { useScraper } from '../contexts/ScraperContext';
import { upsertChannel, deleteChannel, clearChannelPosts, saveNetworkLog } from '../lib/repository';
import { useApiStatus } from '../hooks/useApiStatus';
import { api } from "@/api";
import { buildActiveProxies, isNetworkRoutingActive } from "@/lib/syncSettings";
import { Modal } from './ui/Modal';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tg-tooltip';

interface ChannelGridProps {}

type SortOption = 'activity_rate' | 'total_posts' | 'last_updated' | 'channel_id' | 'channel_name' | 'followed_at' | 'subscribers';

export const ChannelGrid: React.FC<ChannelGridProps> = () => {
  const { 
    channels, 
    setChannels,
    channelStats, 
    selectedChannels, 
    setSelectedChannels,
    loadChannels,
    loadDBStats,
    loadNetworkLogs
  } = useData();
  
  const { summarizing } = useUI();
  
  const [sortBy, setSortBy] = useState<SortOption>(() => {
    const saved = localStorage.getItem('channelGrid_sortBy');
    return (saved as SortOption) || 'last_updated';
  });
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(() => {
    const saved = localStorage.getItem('channelGrid_sortDirection');
    return (saved as 'asc' | 'desc') || 'desc';
  });

  useEffect(() => {
    localStorage.setItem('channelGrid_sortBy', sortBy);
  }, [sortBy]);

  useEffect(() => {
    localStorage.setItem('channelGrid_sortDirection', sortDirection);
  }, [sortDirection]);
  
    const { 
    autoSyncEnabled, 
    setAutoSyncEnabled, 
    autoSyncInterval, 
    setAutoSyncInterval,
    proxyEnabled,
    defaultProxyUrls,
    torEnabled,
    torMode,
    torProxyUrls,
    torRotationStrategy,
    torAutoRotate,
    torRotationThreshold,
    getEffectiveGlobalStartTime,
    showChannelSubscribers
  } = useSettings();

  const { isOffline } = useApiStatus();

  const {
    scrapingChannels,
    syncQueue,
    filteredPosts,
    handleScrapeSelected,
    handleScrapeAll,
    addToSyncQueue
  } = useScraper();

  const [inlineChannelName, setInlineChannelName] = useState("");
  const [channelSearch, setChannelSearch] = useState("");
  const [selectedLanguageFilter, setSelectedLanguageFilter] = useState<string>("");
  const [bulkTagInput, setBulkTagInput] = useState("");
  const [bulkRemoveTagInput, setBulkRemoveTagInput] = useState("");
  const [confirmResetModal, setConfirmResetModal] = useState<Channel | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const filteredChannels = useMemo(() => {
    let result = channels;
    if (selectedLanguageFilter) {
      result = result.filter(c => c.language === selectedLanguageFilter);
    }
    if (channelSearch.trim()) {
      const query = channelSearch.toLowerCase();
      result = result.filter(c => 
        c.name.toLowerCase().includes(query) || 
        (c.displayName && c.displayName.toLowerCase().includes(query)) ||
        (c.tags && c.tags.some(t => t.toLowerCase().includes(query)))
      );
    }
    return result;
  }, [channels, channelSearch, selectedLanguageFilter]);

  const [visibleChannels, setVisibleChannels] = useState(20);
  const observerTarget = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisibleChannels(20);
  }, [channels.length]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleChannels((prev) => prev + 20);
        }
      },
      { threshold: 0.1 }
    );

    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }

    return () => {
      if (observerTarget.current) {
        observer.unobserve(observerTarget.current);
      }
    };
  }, [observerTarget.current]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    channels.forEach(c => {
      c.tags?.forEach(t => tags.add(t));
    });
    return Array.from(tags).sort();
  }, [channels]);

  const allLanguages = useMemo(() => {
    const langs = new Set<string>();
    channels.forEach(c => {
      if (c.language) langs.add(c.language);
    });
    return Array.from(langs).sort();
  }, [channels]);

  const handleSelectAll = () => {
    setSelectedChannels(new Set(filteredChannels.filter(c => !c.isFrozen).map(c => c.name)));
  };

  const handleUnselectAll = () => {
    setSelectedChannels(new Set());
  };

  const toggleTagSelection = (tag: string) => {
    const channelsWithTag = channels.filter(c => c.tags?.includes(tag) && !c.isFrozen).map(c => c.name);
    const allSelected = channelsWithTag.every(name => selectedChannels.has(name));
    
    setSelectedChannels(prev => {
      const next = new Set(prev);
      if (allSelected) {
        channelsWithTag.forEach(name => next.delete(name));
      } else {
        channelsWithTag.forEach(name => next.add(name));
      }
      return next;
    });
  };

  const toggleChannelSelection = (name: string) => {
    const channel = channels.find(c => c.name === name);
    if (channel?.isFrozen) return;
    
    setSelectedChannels(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const [confirmDeleteChannel, setConfirmDeleteChannel] = useState<Channel | null>(null);

  const handleRemoveChannel = (channel: Channel) => {
    setConfirmDeleteChannel(channel);
  };

  const executeDeleteChannel = async () => {
    if (!confirmDeleteChannel) return;
    await deleteChannel(confirmDeleteChannel.id);
    await clearChannelPosts(confirmDeleteChannel.name);
    await loadChannels();
    await loadDBStats();
    setConfirmDeleteChannel(null);
  };

  const handleBulkFreeze = async () => {
    const updatedChannels = channels.map(c => {
      if (selectedChannels.has(c.name) && !c.isUnavailableOnWebView) {
        return { ...c, isFrozen: true };
      }
      return c;
    });
    setChannels(updatedChannels);
    for (const c of updatedChannels) {
      if (selectedChannels.has(c.name) && !c.isUnavailableOnWebView) {
        await upsertChannel(c);
      }
    }
  };

  const handleBulkUnfreeze = async () => {
    const updatedChannels = channels.map(c => {
      if (selectedChannels.has(c.name) && !c.isUnavailableOnWebView) {
        return { ...c, isFrozen: false };
      }
      return c;
    });
    setChannels(updatedChannels);
    for (const c of updatedChannels) {
      if (selectedChannels.has(c.name) && !c.isUnavailableOnWebView) {
        await upsertChannel(c);
      }
    }
  };

  const handleBulkAddTag = async () => {
    if (!bulkTagInput.trim()) return;
    const tag = bulkTagInput.trim();
    const updatedChannels = channels.map(c => {
      if (selectedChannels.has(c.name)) {
        const newTags = Array.from(new Set([...(c.tags || []), tag]));
        return { ...c, tags: newTags };
      }
      return c;
    });
    setChannels(updatedChannels);
    for (const c of updatedChannels) {
      if (selectedChannels.has(c.name)) {
        await upsertChannel(c);
      }
    }
    setBulkTagInput("");
  };

  const handleBulkRemoveTag = async () => {
    if (!bulkRemoveTagInput.trim()) return;
    const tag = bulkRemoveTagInput.trim();
    const updatedChannels = channels.map(c => {
      if (selectedChannels.has(c.name)) {
        const newTags = (c.tags || []).filter(t => t !== tag);
        return { ...c, tags: newTags };
      }
      return c;
    });
    setChannels(updatedChannels);
    for (const c of updatedChannels) {
      if (selectedChannels.has(c.name)) {
        await upsertChannel(c);
      }
    }
    setBulkRemoveTagInput("");
  };

  const executeBulkDelete = async () => {
    for (const name of Array.from(selectedChannels)) {
      await deleteChannel(name);
      await clearChannelPosts(name);
    }
    await loadChannels();
    await loadDBStats();
    setSelectedChannels(new Set());
    setConfirmBulkDelete(false);
  };

  const handleResetAndSync = async (channel: Channel) => {
    setConfirmResetModal(channel);
  };

  const executeResetAndSync = async () => {
    if (!confirmResetModal) return;
    try {
      await api.bulkResetSync({
        confirm: true,
        channelIds: [confirmResetModal.id],
      });
      await clearChannelPosts(confirmResetModal.name);
      await loadChannels();
    } catch (err) {
      console.error("Reset & sync failed:", err);
      await clearChannelPosts(confirmResetModal.name);
      addToSyncQueue(confirmResetModal, "Manual (Reset & Sync)", () => {});
    }
    setConfirmResetModal(null);
  };

  const handleAddChannel = async () => {
    if (!inlineChannelName) return;
    const channelName = inlineChannelName.trim().replace(/^@/, '').split('/').pop() || "";
    if (!channelName) return;
    
    let displayName = channelName;
    let photoUrl = undefined;
    const effectiveStartTime = getEffectiveGlobalStartTime();

    const proxySettings = {
      proxyEnabled,
      defaultProxyUrls,
      torEnabled,
      torMode,
      torProxyUrls,
    };
    const activeProxies = buildActiveProxies(proxySettings);

    const startTime = Date.now();
    let status = 0;
    let errorMsg: string | undefined;
    let telemetryData: any;

    let bio: string | undefined;
    let subscribers: string | undefined;
    let photos: string | undefined;
    let videos: string | undefined;
    let files: string | undefined;
    let links: string | undefined;

    try {
      const data = await api.channelInfo({
        channelName,
        proxyEnabled: isNetworkRoutingActive(proxySettings),
        proxies: activeProxies,
        torAutoRotate,
        torRotationThreshold,
      }) as Record<string, unknown>;
      
      status = 200;
      telemetryData = data.telemetry;

      if (data.displayName) displayName = data.displayName as string;
      if (data.photoUrl) photoUrl = data.photoUrl as string;
      if (data.bio) bio = data.bio as string;
      if (data.subscribers) subscribers = data.subscribers as string;
      if (data.photos) photos = data.photos as string;
      if (data.videos) videos = data.videos as string;
      if (data.files) files = data.files as string;
      if (data.links) links = data.links as string;
    } catch (err: any) {
      console.error("Failed to fetch initial channel info:", err);
      errorMsg = err.message;
    } finally {
      const duration = Date.now() - startTime;
      const proxyUsed = telemetryData?.attempts?.[telemetryData.attempts.length - 1]?.proxyUrl;
      const attempts = telemetryData?.attempts?.length || 1;
      
      const logEntry: NetworkLog = {
        id: crypto.randomUUID(),
        url: `https://t.me/s/${channelName}`,
        method: "GET",
        status: status === 200 ? "success" : "failed",
        statusCode: status,
        duration: telemetryData?.totalDuration || duration,
        source: "ChannelGrid",
        timestamp: Date.now(),
        error: errorMsg,
        proxyUsed,
        attempts,
        telemetry: telemetryData
      };
      saveNetworkLog(logEntry).then(() => loadNetworkLogs()).catch(e => console.error("Failed to save network log:", e));
    }

    const newChannel: Channel = {
      id: channelName,
      name: channelName,
      displayName,
      photoUrl,
      bio,
      subscribers,
      photos,
      videos,
      files,
      links,
      startTime: effectiveStartTime,
      lastUpdated: Date.now(),
      followedAt: Date.now(),
      tags: [],
      autoFollowForwarded: false,
    };
    
    await upsertChannel(newChannel);
    await loadChannels();
    setSelectedChannels(prev => new Set(prev).add(channelName));
    setInlineChannelName("");
    addToSyncQueue(newChannel, "Initial Sync", () => {});
  };

  return (
    <motion.div
      key="channels"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Unified Control Bar */}
      <div className="bg-app-card rounded-xl border border-app-ink/10 shadow-sm p-4 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-col sm:flex-row flex-1 gap-2 max-w-2xl">
            {/* Modern Input */}
            <div className="relative flex-1" id="tour-add-channel">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span className="text-app-ink/40 font-bold">@</span>
              </div>
              <input
                type="text"
                value={inlineChannelName}
                onChange={(e) => setInlineChannelName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddChannel()}
                placeholder="telegram_channel"
                className="w-full bg-app-muted/50 border border-app-ink/10 rounded-lg py-2 pl-8 pr-20 text-sm focus:outline-none focus:ring-2 focus:ring-app-ink/20 transition-all"
              />
              <button
                onClick={handleAddChannel}
                disabled={!inlineChannelName.trim()}
                className="absolute inset-y-1 right-1 px-4 bg-app-ink text-app-bg text-[10px] uppercase font-bold rounded-md hover:opacity-90 transition-opacity disabled:opacity-30"
              >
                Add
              </button>
            </div>
            {/* Search Channels Input */}
            <div className="relative flex-1">
              <input
                type="text"
                value={channelSearch}
                onChange={(e) => setChannelSearch(e.target.value)}
                placeholder="Search channels..."
                className="w-full bg-app-muted/50 border border-app-ink/10 rounded-lg py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-app-ink/20 transition-all"
              />
            </div>
          </div>

          {/* Action Grouping */}
          {channels.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex bg-app-muted/50 p-1 rounded-lg border border-app-ink/5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button onClick={handleSelectAll} className="px-3 py-1.5 text-[10px] uppercase font-bold rounded-md hover:bg-app-card hover:shadow-sm transition-all text-app-ink/70 hover:text-app-ink">
                      All
                    </button>
                  </TooltipTrigger>
                  <TooltipContent><p>Select All</p></TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button onClick={handleUnselectAll} className="px-3 py-1.5 text-[10px] uppercase font-bold rounded-md hover:bg-app-card hover:shadow-sm transition-all text-app-ink/70 hover:text-app-ink">
                      None
                    </button>
                  </TooltipTrigger>
                  <TooltipContent><p>Clear Selection</p></TooltipContent>
                </Tooltip>
              </div>

              <div className="h-6 w-px bg-app-ink/10 mx-1"></div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleScrapeSelected}
                    disabled={isOffline || scrapingChannels.size > 0 || summarizing || selectedChannels.size === 0}
                    className="h-8 px-4 text-[10px] uppercase font-bold flex items-center gap-2 bg-app-ink/10 text-app-ink hover:bg-app-ink/20 transition-all rounded-lg disabled:opacity-30"
                  >
                    <RefreshCw size={12} className={scrapingChannels.size > 0 ? "animate-spin" : ""} />
                    <span className="hidden sm:inline">Sync Selected</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent><p>Sync Selected Channels</p></TooltipContent>
              </Tooltip>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleScrapeAll}
                    disabled={isOffline || scrapingChannels.size > 0 || summarizing}
                    className="h-8 px-4 text-[10px] uppercase font-bold flex items-center gap-2 bg-app-ink text-app-bg hover:opacity-90 transition-all rounded-lg shadow-sm disabled:opacity-30"
                  >
                    <RefreshCw size={12} className={scrapingChannels.size > 0 ? "animate-spin" : ""} />
                    <span className="hidden sm:inline">Sync All</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent><p>Sync All Channels</p></TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>

        {/* Tags & Auto Sync row */}
        {channels.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t border-app-ink/5">
            <div className="flex flex-wrap gap-2">
              {allTags.map(tag => {
                const channelsWithTag = channels.filter(c => c.tags?.includes(tag)).map(c => c.name);
                const selectedCount = channelsWithTag.filter(name => selectedChannels.has(name)).length;
                const isAllSelected = selectedCount === channelsWithTag.length && channelsWithTag.length > 0;
                const isPartial = selectedCount > 0 && selectedCount < channelsWithTag.length;

                return (
                  <button
                    key={tag}
                    onClick={() => toggleTagSelection(tag)}
                    className={`text-[9px] uppercase font-bold px-2 py-1 rounded-md transition-all flex items-center gap-1.5 ${
                      isAllSelected 
                        ? 'bg-app-ink text-app-bg' 
                        : isPartial
                        ? 'bg-app-ink/20 text-app-ink'
                        : 'bg-app-muted/50 text-app-ink/60 hover:bg-app-ink/10 hover:text-app-ink'
                    }`}
                  >
                    <Tag size={10} />
                    {tag}
                    <span className="opacity-60 text-[8px]">({selectedCount}/{channelsWithTag.length})</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-3 bg-app-muted/30 p-1.5 px-3 rounded-lg border border-app-ink/5 w-fit">
              {allLanguages.length > 0 && (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] uppercase font-bold text-app-ink/50">Lang</span>
                    <select 
                      value={selectedLanguageFilter}
                      onChange={(e) => setSelectedLanguageFilter(e.target.value)}
                      className="bg-transparent text-[10px] font-bold text-app-ink outline-none cursor-pointer max-w-[80px] truncate"
                    >
                      <option value="">All</option>
                      {allLanguages.map(lang => (
                        <option key={lang} value={lang}>{lang}</option>
                      ))}
                    </select>
                  </div>
                  <div className="h-4 w-px bg-app-ink/10"></div>
                </>
              )}
              <div className="flex items-center gap-2">
                <span className="text-[9px] uppercase font-bold text-app-ink/50">Sort By</span>
                <select 
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="bg-transparent text-[10px] font-bold text-app-ink outline-none cursor-pointer"
                >
                  <option value="last_updated">Last Updated</option>
                  <option value="followed_at">Followed At</option>
                  <option value="activity_rate">Activity Rate</option>
                  <option value="total_posts">Total Posts</option>
                  <option value="channel_id">Channel ID</option>
                  <option value="channel_name">Channel Name</option>
                  {showChannelSubscribers && <option value="subscribers">Subscribers</option>}
                </select>
                <button
                  onClick={() => setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
                  className="p-1 hover:bg-app-ink/10 rounded-md transition-colors text-app-ink/70 hover:text-app-ink"
                  title={`Sort ${sortDirection === 'asc' ? 'Ascending' : 'Descending'}`}
                >
                  {sortDirection === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                </button>
              </div>

              <div className="h-4 w-px bg-app-ink/10"></div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={autoSyncEnabled}
                  onChange={(e) => setAutoSyncEnabled(e.target.checked)}
                  className="w-3 h-3 accent-app-ink"
                />
                <span className="text-[10px] uppercase font-bold text-app-ink">Auto Sync</span>
              </label>
              
              <div className="h-4 w-px bg-app-ink/10"></div>
              
              <div className="flex items-center gap-2">
                <span className="text-[9px] uppercase font-bold text-app-ink/50">Every</span>
                <select 
                  value={autoSyncInterval}
                  onChange={(e) => setAutoSyncInterval(Number(e.target.value))}
                  disabled={!autoSyncEnabled}
                  className="bg-transparent text-[10px] font-bold text-app-ink outline-none disabled:opacity-50 cursor-pointer"
                >
                  <option value={5}>5 mins</option>
                  <option value={15}>15 mins</option>
                  <option value={30}>30 mins</option>
                  <option value={60}>1 hour</option>
                  <option value={360}>6 hours</option>
                  <option value={720}>12 hours</option>
                  <option value={1440}>24 hours</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Bulk Actions */}
        {selectedChannels.size > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t border-app-ink/5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] uppercase font-bold text-app-ink/70">
                {selectedChannels.size} Selected
              </span>
              <div className="h-4 w-px bg-app-ink/10 mx-1"></div>
              <button
                onClick={handleBulkFreeze}
                className="px-3 py-1.5 text-[10px] uppercase font-bold rounded-md bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 transition-all"
              >
                Freeze
              </button>
              <button
                onClick={handleBulkUnfreeze}
                className="px-3 py-1.5 text-[10px] uppercase font-bold rounded-md bg-app-muted/50 text-app-ink/70 hover:bg-app-ink/10 transition-all"
              >
                Unfreeze
              </button>
              <div className="relative">
                <input
                  type="text"
                  value={bulkTagInput}
                  onChange={(e) => setBulkTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleBulkAddTag()}
                  placeholder="Add tag..."
                  className="w-32 bg-app-muted/50 border border-app-ink/10 rounded-md py-1.5 pl-2 pr-10 text-[10px] focus:outline-none focus:ring-1 focus:ring-app-ink/20 transition-all"
                />
                <button
                  onClick={handleBulkAddTag}
                  disabled={!bulkTagInput.trim()}
                  className="absolute inset-y-1 right-1 px-2 bg-app-ink text-app-bg text-[8px] uppercase font-bold rounded hover:opacity-90 transition-opacity disabled:opacity-30"
                >
                  Add
                </button>
              </div>
              <div className="relative">
                <input
                  type="text"
                  value={bulkRemoveTagInput}
                  onChange={(e) => setBulkRemoveTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleBulkRemoveTag()}
                  placeholder="Remove tag..."
                  className="w-32 bg-app-muted/50 border border-app-ink/10 rounded-md py-1.5 pl-2 pr-14 text-[10px] focus:outline-none focus:ring-1 focus:ring-app-ink/20 transition-all"
                />
                <button
                  onClick={handleBulkRemoveTag}
                  disabled={!bulkRemoveTagInput.trim()}
                  className="absolute inset-y-1 right-1 px-2 bg-app-ink text-app-bg text-[8px] uppercase font-bold rounded hover:opacity-90 transition-opacity disabled:opacity-30"
                >
                  Remove
                </button>
              </div>
              <button
                onClick={() => setConfirmBulkDelete(true)}
                className="px-3 py-1.5 text-[10px] uppercase font-bold rounded-md bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-all"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
      
      {filteredChannels.length === 0 ? (
        <div id="tour-channel-grid" className="flex flex-col items-center justify-center py-20 px-4 text-center border border-dashed border-app-ink/20 rounded-2xl bg-app-muted/5">
          <div className="w-20 h-20 bg-app-ink/5 rounded-full flex items-center justify-center mb-6 border border-app-ink/10">
            <Send size={32} className="opacity-20" />
          </div>
          <h3 className="text-xl font-bold mb-2 text-app-ink">No Channels Found</h3>
          <p className="text-sm opacity-60 max-w-md mx-auto mb-8">
            {channels.length === 0 ? "Start by adding a Telegram channel username above. We'll fetch its details and you can begin syncing posts immediately." : "No channels match your search."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" id="tour-channel-grid">
          {[...filteredChannels].sort((a, b) => {
            const getGroup = (c: Channel) => {
              if (c.isFrozen) return 3;
              if (selectedChannels.has(c.name)) return 1;
              return 2;
            };

            const aGroup = getGroup(a);
            const bGroup = getGroup(b);

            if (aGroup !== bGroup) {
              return aGroup - bGroup;
            }
            
            // If both are in the same group, sort by the chosen option
            let comparison = 0;
            if (sortBy === 'activity_rate') {
              const aVel = channelStats[a.name]?.velocity || 0;
              const bVel = channelStats[b.name]?.velocity || 0;
              comparison = aVel - bVel;
            } else if (sortBy === 'total_posts') {
              const aCount = channelStats[a.name]?.count || 0;
              const bCount = channelStats[b.name]?.count || 0;
              comparison = aCount - bCount;
            } else if (sortBy === 'last_updated') {
              const aTime = a.lastUpdated || 0;
              const bTime = b.lastUpdated || 0;
              comparison = aTime - bTime;
            } else if (sortBy === 'followed_at') {
              const aTime = a.followedAt || 0;
              const bTime = b.followedAt || 0;
              comparison = aTime - bTime;
            } else if (sortBy === 'channel_id') {
              const aId = a.startId || 0;
              const bId = b.startId || 0;
              comparison = aId - bId;
            } else if (sortBy === 'channel_name') {
              const aName = a.displayName || a.name;
              const bName = b.displayName || b.name;
              comparison = aName.localeCompare(bName);
            } else if (sortBy === 'subscribers') {
              const parseSubscribers = (subStr?: string) => {
                if (!subStr) return 0;
                const numStr = subStr.replace(/[^0-9.]/g, '');
                let num = parseFloat(numStr) || 0;
                if (subStr.toUpperCase().includes('K')) num *= 1000;
                if (subStr.toUpperCase().includes('M')) num *= 1000000;
                return num;
              };
              const aSubs = parseSubscribers(a.subscribers);
              const bSubs = parseSubscribers(b.subscribers);
              comparison = aSubs - bSubs;
            }
            
            return sortDirection === 'asc' ? comparison : -comparison;
          }).slice(0, visibleChannels).map(channel => (
            <ChannelCard 
              key={channel.id} 
              channel={channel} 
              handleRemoveChannel={handleRemoveChannel} 
              handleResetAndSync={handleResetAndSync} 
            />
          ))}
          
          {/* Intersection Observer Target */}
          <div ref={observerTarget} className="h-10 w-full md:col-span-2" />
        </div>
      )}

      {confirmResetModal && (
        <Modal
          isOpen={!!confirmResetModal}
          onClose={() => setConfirmResetModal(null)}
          title="Reset & Sync Channel"
          footer={
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmResetModal(null)}
                className="px-4 py-2 border border-app-ink/20 hover:bg-app-ink/5 transition-colors text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={executeResetAndSync}
                className="px-4 py-2 bg-red-500 text-white hover:bg-red-600 transition-colors text-sm font-medium"
              >
                Confirm
              </button>
            </div>
          }
        >
          <p className="text-sm opacity-80">
            Clear all posts for <span className="font-bold">@{confirmResetModal.name}</span> and re-sync from ID {confirmResetModal.startId ?? 1}?
          </p>
        </Modal>
      )}

      {confirmDeleteChannel && (
        <Modal
          isOpen={!!confirmDeleteChannel}
          onClose={() => setConfirmDeleteChannel(null)}
          title="Remove Channel?"
          footer={
            <div className="flex items-center gap-3">
              <button
                onClick={() => setConfirmDeleteChannel(null)}
                className="flex-1 px-4 py-2 text-[10px] font-bold uppercase tracking-widest border border-app-ink border-opacity-10 hover:bg-app-muted/50 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={executeDeleteChannel}
                className="flex-1 px-4 py-2 text-[10px] font-bold uppercase tracking-widest bg-red-500 text-white hover:bg-red-600 transition-all shadow-lg shadow-red-500/20"
              >
                Delete Everything
              </button>
            </div>
          }
        >
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
              <ShieldAlert className="text-red-500" size={20} />
            </div>
            <div>
              <p className="text-xs opacity-60 leading-relaxed">
                You are about to remove <span className="font-bold opacity-100">@{confirmDeleteChannel.name}</span>. 
                This will also permanently delete all scraped posts associated with this channel from your local database.
              </p>
            </div>
          </div>
        </Modal>
      )}

      {confirmBulkDelete && (
        <Modal
          isOpen={confirmBulkDelete}
          onClose={() => setConfirmBulkDelete(false)}
          title="Remove Selected Channels?"
          footer={
            <div className="flex items-center gap-3">
              <button
                onClick={() => setConfirmBulkDelete(false)}
                className="flex-1 px-4 py-2 text-[10px] font-bold uppercase tracking-widest border border-app-ink border-opacity-10 hover:bg-app-muted/50 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={executeBulkDelete}
                className="flex-1 px-4 py-2 text-[10px] font-bold uppercase tracking-widest bg-red-500 text-white hover:bg-red-600 transition-all shadow-lg shadow-red-500/20"
              >
                Delete {selectedChannels.size} Channels
              </button>
            </div>
          }
        >
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
              <ShieldAlert className="text-red-500" size={20} />
            </div>
            <div>
              <p className="text-xs opacity-60 leading-relaxed">
                You are about to remove <span className="font-bold opacity-100">{selectedChannels.size} selected channels</span>. 
                This will also permanently delete all scraped posts associated with these channels from your local database.
              </p>
            </div>
          </div>
        </Modal>
      )}
    </motion.div>
  );
};
