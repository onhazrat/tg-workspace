import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { Channel, Post, SyncLog } from "../types";
import { getPostsByDateRange, saveChannel, savePosts, getChannelStats, saveSyncLog } from "../lib/db";
import { useSyncQueue } from "../hooks/useSyncQueue";
import { useData } from "./DataContext";
import { useUI } from "./UIContext";
import { useSettings } from "./SettingsContext";
import { toast } from "sonner";
import { scrapeTelegramChannel, TelegramServiceError, ScrapeResponse, resolveStartTimeToId } from "../services/telegram";
import { useRAG } from "./RAGContext";
import { detectLanguageFromPosts } from "../lib/language";
import { api } from "../api/client";

interface ScraperContextType {
  postSearch: string;
  setPostSearch: React.Dispatch<React.SetStateAction<string>>;
  semanticSearchQuery: string;
  setSemanticSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  semanticSearchRespectsTimeRange: boolean;
  setSemanticSearchRespectsTimeRange: React.Dispatch<React.SetStateAction<boolean>>;
  semanticSearchRespectsChannels: boolean;
  setSemanticSearchRespectsChannels: React.Dispatch<React.SetStateAction<boolean>>;
  relatedPostSearch: Post | null;
  setRelatedPostSearch: React.Dispatch<React.SetStateAction<Post | null>>;
  isFiltering: boolean;
  scrapingChannels: Set<string>;
  setScrapingChannels: React.Dispatch<React.SetStateAction<Set<string>>>;
  filteredPosts: Post[];
  visiblePosts: number;
  setVisiblePosts: React.Dispatch<React.SetStateAction<number>>;
  handleFilterPosts: () => Promise<void>;
  setFilteredPosts: React.Dispatch<React.SetStateAction<Post[]>>;
  handleScrapeChannel: (channel: Channel, refresh?: boolean, source?: string) => Promise<void>;
  handleScrapeAll: () => Promise<void>;
  handleScrapeSelected: () => Promise<void>;
  scrapeChannelsInParallel: (channelsToScrape: Channel[], source: string) => Promise<void>;
  syncQueue: { channel: Channel; source: string; resolve?: () => void }[];
  isProcessingQueue: boolean;
  addToSyncQueue: (channel: Channel, source: string, resolve?: () => void) => void;
  autoSyncPauseUntil: number | null;
  setAutoSyncPauseUntil: React.Dispatch<React.SetStateAction<number | null>>;
  consecutiveFailures: number;
  setConsecutiveFailures: React.Dispatch<React.SetStateAction<number>>;
  addNewChannel: (channelName: string, discoveredVia?: { channelName: string; postId: number; timestamp: number }) => Promise<void>;
  forwardedFilter: 'all' | 'forwarded' | 'original' | 'unfollowed_forwarded';
  setForwardedFilter: React.Dispatch<React.SetStateAction<'all' | 'forwarded' | 'original' | 'unfollowed_forwarded'>>;
}

const ScraperContext = createContext<ScraperContextType | undefined>(undefined);

export const ScraperProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { channels, selectedChannels, channelStats, setChannelStats, loadChannels, loadSyncLogs } = useData();
  const { startDate, endDate, setIsRateLimited, activeTab, setActiveTab, summarizing } = useUI();
  const { 
    proxyEnabled, 
    proxyUrls, 
    torEnabled, 
    torMode,
    torProxyUrls, 
    torRotationStrategy,
    torControlEnabled,
    torControlPort,
    torControlPassword,
    torAutoRotate,
    torRotationThreshold,
    syncConcurrency,
    embeddingsEnabled,
    autoFollowForwarded,
    getEffectiveGlobalStartTime
  } = useSettings();
  const { searchSimilarPosts } = useRAG();

  const [postSearch, setPostSearch] = useState("");
  const [semanticSearchQuery, setSemanticSearchQuery] = useState("");
  const [semanticSearchRespectsTimeRange, setSemanticSearchRespectsTimeRange] = useState(false);
  const [semanticSearchRespectsChannels, setSemanticSearchRespectsChannels] = useState(false);
  const [relatedPostSearch, setRelatedPostSearch] = useState<Post | null>(null);
  const [isFiltering, setIsFiltering] = useState(false);
  const [scrapingChannels, setScrapingChannels] = useState<Set<string>>(new Set());
  const [filteredPosts, setFilteredPosts] = useState<Post[]>([]);
  const [visiblePosts, setVisiblePosts] = useState(20);
  const [autoSyncPauseUntil, setAutoSyncPauseUntil] = useState<number | null>(null);
  const [consecutiveFailures, setConsecutiveFailures] = useState<number>(0);
  const [torIndex, setTorIndex] = useState(0);
  const [forwardedFilter, setForwardedFilter] = useState<'all' | 'forwarded' | 'original' | 'unfollowed_forwarded'>('all');
  const scrapingLocksRef = React.useRef<Set<string>>(new Set());

  // Background language detection for existing channels
  useEffect(() => {
    const detectMissingLanguages = async () => {
      const channelsWithoutLanguage = channels.filter(c => !c.language && !c.isUnavailableOnWebView);
      if (channelsWithoutLanguage.length === 0) return;

      for (const channel of channelsWithoutLanguage) {
        try {
          const recentPosts = await getPostsByDateRange([channel.name], 0, Date.now());
          if (recentPosts && recentPosts.length > 0) {
            recentPosts.sort((a, b) => b.id - a.id);
            const lang = detectLanguageFromPosts(recentPosts);
            if (lang) {
              const updatedChannel = { ...channel, language: lang };
              await saveChannel(updatedChannel);
              console.log(`[Background] Detected language for @${channel.name}: ${lang}`);
            }
          }
        } catch (e) {
          console.error(`[Background] Failed to detect language for @${channel.name}`, e);
        }
      }
      // Reload channels after updating
      await loadChannels();
    };

    // Run once after a short delay to not block initial render
    const timer = setTimeout(detectMissingLanguages, 5000);
    return () => clearTimeout(timer);
  }, [channels.length]); // Only re-run if channel count changes

  const handleFilterPosts = useCallback(async () => {
    setIsFiltering(true);
    try {
      if (embeddingsEnabled && relatedPostSearch) {
        try {
          const results = await searchSimilarPosts(relatedPostSearch.text, 50);
          // Filter out the post itself
          let otherPosts = results.filter(p => p.id !== relatedPostSearch.id || p.channelName !== relatedPostSearch.channelName);
          
          if (forwardedFilter === 'forwarded') {
            otherPosts = otherPosts.filter(p => !!p.forwardedFrom);
          } else if (forwardedFilter === 'original') {
            otherPosts = otherPosts.filter(p => !p.forwardedFrom);
          } else if (forwardedFilter === 'unfollowed_forwarded') {
            otherPosts = otherPosts.filter(p => p.forwardedFrom && !channels.some(c => c.name.toLowerCase() === p.forwardedFrom?.toLowerCase()));
          }
          
          setFilteredPosts(otherPosts);
          setVisiblePosts(20);
        } catch (error) {
          console.error("Related post search failed:", error);
          toast.error("Related post search failed. Falling back to normal view.");
          setRelatedPostSearch(null);
        }
        return;
      }

      if (embeddingsEnabled && semanticSearchQuery.trim()) {
        try {
          let results = await searchSimilarPosts(semanticSearchQuery, 50);
          
          if (semanticSearchRespectsTimeRange) {
            results = results.filter(p => p.timestamp >= startDate && p.timestamp <= endDate);
          }
          
          if (semanticSearchRespectsChannels && selectedChannels.size > 0) {
            results = results.filter(p => selectedChannels.has(p.channelName));
          }
          
          if (forwardedFilter === 'forwarded') {
            results = results.filter(p => !!p.forwardedFrom);
          } else if (forwardedFilter === 'original') {
            results = results.filter(p => !p.forwardedFrom);
          } else if (forwardedFilter === 'unfollowed_forwarded') {
            results = results.filter(p => p.forwardedFrom && !channels.some(c => c.name.toLowerCase() === p.forwardedFrom?.toLowerCase()));
          }
          
          setFilteredPosts(results);
          setVisiblePosts(20);
        } catch (error) {
          console.error("Semantic search failed:", error);
          toast.error("Semantic search failed. Falling back to normal view.");
          setSemanticSearchQuery("");
        }
        return;
      }

      const selectedNames = Array.from(selectedChannels);
      let posts = await getPostsByDateRange(selectedNames, startDate, endDate);
      
      if (postSearch.trim()) {
        const query = postSearch.toLowerCase();
        posts = posts.filter(post => 
          post.text.toLowerCase().includes(query) || 
          post.channelName.toLowerCase().includes(query)
        );
      }
      
      if (forwardedFilter === 'forwarded') {
        posts = posts.filter(p => !!p.forwardedFrom);
      } else if (forwardedFilter === 'original') {
        posts = posts.filter(p => !p.forwardedFrom);
      } else if (forwardedFilter === 'unfollowed_forwarded') {
        posts = posts.filter(p => p.forwardedFrom && !channels.some(c => c.name.toLowerCase() === p.forwardedFrom?.toLowerCase()));
      }
      
      setFilteredPosts(posts.sort((a, b) => b.timestamp - a.timestamp));
      setVisiblePosts(20); // Reset visible posts when filters change
    } finally {
      setIsFiltering(false);
    }
  }, [startDate, endDate, selectedChannels, postSearch, semanticSearchQuery, relatedPostSearch, embeddingsEnabled, semanticSearchRespectsTimeRange, semanticSearchRespectsChannels, searchSimilarPosts, forwardedFilter]);

  const handleScrapeChannel = useCallback(async (channel: Channel, refresh = true, source = "Manual") => {
    if (channel.isFrozen) {
      console.log(`[Scraper] Skipping sync for @${channel.name} because it is frozen.`);
      return;
    }
    if (scrapingLocksRef.current.has(channel.name)) {
      console.log(`[Scraper] Sync already in progress for @${channel.name}. Skipping duplicate request.`);
      return;
    }
    scrapingLocksRef.current.add(channel.name);
    console.log(`[Scraper] Starting sync for @${channel.name} from source: ${source}`);
    setScrapingChannels(prev => new Set(prev).add(channel.name));
    
    let totalNewPosts = 0;
    let finalLatestId = 0;
    const requests: any[] = [];
    const responses: any[] = [];
    try {
      const proxies = proxyUrls.split(/[\n,]+/).map(p => p.trim()).filter(p => p);
      const torPool = torProxyUrls.split(/[\n,]+/).map(p => p.trim()).filter(p => p);
      let activeProxies: string[] = [];
      if (proxyEnabled) activeProxies.push(...proxies);
      if (torEnabled) {
        if (torMode === "auto") activeProxies.push("socks5h://127.0.0.1:9050");
        else activeProxies.push(...torPool);
      }

      // Resolve startId if it's missing but startTime is present
      if (channel.startId === undefined && channel.startTime !== undefined) {
        toast.info(`Resolving start time for @${channel.name}...`);
        const resolvedId = await resolveStartTimeToId(
          channel.name,
          channel.startTime,
          activeProxies.length > 0,
          activeProxies,
          torAutoRotate,
          torRotationThreshold,
          torControlPort,
          torControlPassword
        );
        channel.startId = resolvedId;
        await saveChannel({ ...channel, startId: resolvedId });
        toast.success(`Resolved start ID for @${channel.name}: ${resolvedId}`);
      }

      let currentMaxId = channelStats[channel.name]?.maxId || (channel.startId || 1) - 1;
      let hasMore = true;
      let knownLatestId = channelStats[channel.name]?.latestId || 0;

      let retryCount = 0;
      const MAX_RETRIES = 3;

      while (hasMore) {
        let response: ScrapeResponse;
        
        try {
          response = await scrapeTelegramChannel(
            channel.name,
            currentMaxId + 1,
            knownLatestId > 0 ? knownLatestId : undefined,
            knownLatestId > 0 ? channel.displayName : undefined,
            knownLatestId > 0 ? channel.photoUrl : undefined,
            activeProxies.length > 0, // Enable proxy if we have any in the pool
            activeProxies,
            torAutoRotate,
            torRotationThreshold,
            torControlPort,
            torControlPassword
          );
          if (response.fullRequest) requests.push(response.fullRequest);
          if (response.fullResponse) responses.push(response.fullResponse);
        } catch (error) {
          if (error instanceof TelegramServiceError) {
            if (error.fullRequest) requests.push(error.fullRequest);
            if (error.fullResponse) responses.push(error.fullResponse);
          }
          const isRateLimit = (error instanceof TelegramServiceError && error.isRateLimited);
          const isNetworkError = error instanceof Error && (
            error.message.includes('ECONNRESET') || 
            error.message.includes('timeout') || 
            error.message.includes('Network Error')
          );

          if (retryCount < MAX_RETRIES && (isRateLimit || isNetworkError)) {
            if (isRateLimit) {
              setIsRateLimited(true);
              
              // If TOR Control is enabled, try to get a new identity
              if (torEnabled && torControlEnabled) {
                console.log("[TOR] Rate limit detected. Requesting new identity...");
                try {
                  await api.torNewIdentity(torControlPort);
                  // Small delay to let TOR establish the new circuit
                  await new Promise(resolve => setTimeout(resolve, 2000));
                } catch (e) {
                  console.error("[TOR] Failed to request new identity:", e);
                }
              }
            }
            retryCount++;
            const backoffTime = Math.pow(2, retryCount) * 2000; // 4s, 8s, 16s
            console.log(`${isRateLimit ? 'Rate limited' : 'Network error'}. Retrying in ${backoffTime}ms (Attempt ${retryCount}/${MAX_RETRIES})...`);
            await new Promise(resolve => setTimeout(resolve, backoffTime));
            continue;
          }
          throw error;
        }

        // Reset retry count and rate limit status on success
        retryCount = 0;
        setIsRateLimited(false);

        const posts = response.posts || [];
        const latestId = response.latestId || 0;
        finalLatestId = latestId;
        const displayName = response.displayName;
        const photoUrl = response.photoUrl;
        const bio = response.bio;
        const subscribers = response.subscribers;
        const photos = response.photos;
        const videos = response.videos;
        const files = response.files;
        const links = response.links;
        
        if (latestId) {
          knownLatestId = latestId;
        }

        let channelChanged = false;
        if (displayName && displayName !== channel.displayName) {
          channel.displayName = displayName;
          channelChanged = true;
        }
        if (photoUrl && photoUrl !== channel.photoUrl) {
          channel.photoUrl = photoUrl;
          channelChanged = true;
        }
        if (bio && bio !== channel.bio) {
          channel.bio = bio;
          channelChanged = true;
        }
        if (subscribers && subscribers !== channel.subscribers) {
          channel.subscribers = subscribers;
          channelChanged = true;
        }
        if (photos && photos !== channel.photos) {
          channel.photos = photos;
          channelChanged = true;
        }
        if (videos && videos !== channel.videos) {
          channel.videos = videos;
          channelChanged = true;
        }
        if (files && files !== channel.files) {
          channel.files = files;
          channelChanged = true;
        }
        if (links && links !== channel.links) {
          channel.links = links;
          channelChanged = true;
        }
        
        if (channelChanged) {
          Object.assign(channel, { 
            displayName: channel.displayName, 
            photoUrl: channel.photoUrl,
            bio: channel.bio,
            subscribers: channel.subscribers,
            photos: channel.photos,
            videos: channel.videos,
            files: channel.files,
            links: channel.links
          });
          await saveChannel(channel);
        }

        if (posts.length === 0) {
          hasMore = false;
          break;
        }

        const postsToSave: Post[] = posts.map((p: Post) => {
          const parsedTime = p.date ? new Date(p.date).getTime() : NaN;
          return {
            ...p,
            channelName: channel.name,
            timestamp: isNaN(parsedTime) ? Date.now() : parsedTime
          };
        });
        
        await savePosts(postsToSave);
        totalNewPosts += postsToSave.length;
        
        // Auto-follow logic
        if (autoFollowForwarded) {
          for (const p of postsToSave) {
            if (p.forwardedFrom) {
              const cleanForwardedName = p.forwardedFrom.trim().replace(/^@/, '').split('/').pop() || "";
              if (cleanForwardedName && !channels.some(c => c.name.toLowerCase() === cleanForwardedName.toLowerCase())) {
                // We haven't followed this channel yet. Let's add it.
                // Note: addNewChannel handles checking if it exists again, but doing it here prevents unnecessary calls.
                // We don't await here to avoid blocking the main scraping loop too much, 
                // but we might want to if we want to ensure it's added before the next post is processed.
                // Let's just call it and let it run.
                addNewChannel(cleanForwardedName, {
                  channelName: p.channelName,
                  postId: p.id,
                  timestamp: p.timestamp
                }).catch(err => console.error("Auto-follow failed for", cleanForwardedName, err));
              }
            }
          }
        }
        
        // Update stats immediately for "streaming" feel
        const newMaxId = Math.max(...postsToSave.map(p => p.id));
        currentMaxId = newMaxId;
        
        const s = await getChannelStats(channel.name);
        if (s) {
          setChannelStats(prev => ({ 
            ...prev, 
            [channel.name]: { ...s, latestId } 
          }));
        }

        // If we've reached the latest ID known by the server, we can stop
        if (currentMaxId >= latestId) {
          hasMore = false;
        }
        
        // Safety break to avoid infinite loops if something goes wrong
        if (posts.length < 10) { // Telegram usually returns ~20, if less it might be the end
           hasMore = false;
        }
      }

      // Detect language if not set
      let detectedLanguage = channel.language;
      if (!detectedLanguage) {
        try {
          const recentPosts = await getPostsByDateRange([channel.name], 0, Date.now());
          if (recentPosts && recentPosts.length > 0) {
            // Sort by ID descending to get latest posts
            recentPosts.sort((a, b) => b.id - a.id);
            const lang = detectLanguageFromPosts(recentPosts);
            if (lang) {
              detectedLanguage = lang;
              console.log(`[Scraper] Detected language for @${channel.name}: ${lang}`);
            }
          }
        } catch (e) {
          console.error(`[Scraper] Failed to detect language for @${channel.name}`, e);
        }
      }

      // Update last updated time and language
      const updatedChannel = { ...channel, lastUpdated: Date.now(), language: detectedLanguage };
      await saveChannel(updatedChannel);
      
      // Reset consecutive failures on success
      setConsecutiveFailures(0);
      setAutoSyncPauseUntil(null);

      if (refresh) {
        await loadChannels();
        await handleFilterPosts();
      }

      // Log success
      const log: SyncLog = {
        id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
        channelName: channel.name,
        status: "success",
        postsCount: totalNewPosts,
        newLatestId: finalLatestId,
        timestamp: Date.now(),
        source: source,
        fullRequest: requests,
        fullResponse: responses
      };
      console.log(`[Scraper] Sync successful for @${channel.name}. Total new posts: ${totalNewPosts}. Latest ID: ${finalLatestId}`);
      console.log(`[Scraper] Saving success log for @${channel.name}...`);
      await saveSyncLog(log);
      console.log(`[Scraper] Success log saved. Refreshing logs...`);
      await loadSyncLogs();
      console.log(`[Scraper] Logs refreshed.`);
    } catch (err: unknown) {
      if (err instanceof TelegramServiceError && err.isUnavailableOnWebView) {
        const updatedChannel = { ...channel, isFrozen: true, isUnavailableOnWebView: true };
        await saveChannel(updatedChannel);
        toast.error(`Channel @${channel.name} is unavailable on the web view and has been frozen.`);
      }

      if (refresh) {
        await loadChannels();
        await handleFilterPosts();
      }

      setConsecutiveFailures(prev => {
        const next = prev + 1;
        if (next >= Math.max(3, channels.length)) {
          setAutoSyncPauseUntil(Date.now() + 10 * 60 * 1000);
          toast.error("Auto-sync paused for 10 minutes due to consecutive failures.");
        }
        return next;
      });

      console.error(`[Scraper] Sync failed for @${channel.name}:`, err);
      // Log failure
      const log: SyncLog = {
        id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
        channelName: channel.name,
        status: "failed",
        postsCount: totalNewPosts,
        error: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
        source: source,
        fullRequest: requests,
        fullResponse: responses
      };
      console.log(`[Scraper] Saving failure log for @${channel.name}...`);
      await saveSyncLog(log);
      console.log(`[Scraper] Failure log saved. Refreshing logs...`);
      await loadSyncLogs();
      console.log(`[Scraper] Logs refreshed.`);
      throw err;
    } finally {
      scrapingLocksRef.current.delete(channel.name);
      setScrapingChannels(prev => {
        const next = new Set(prev);
        next.delete(channel.name);
        return next;
      });
    }
  }, [channelStats, loadChannels, loadSyncLogs, handleFilterPosts, setChannelStats, setIsRateLimited, proxyEnabled, proxyUrls, torEnabled, torMode, torProxyUrls, torRotationStrategy, torIndex, torControlEnabled, torControlPort, torControlPassword]);

  const { syncQueue, addToSyncQueue, isProcessingQueue } = useSyncQueue(
    useCallback(async (channel, source) => {
      await handleScrapeChannel(channel, false, source);
      await loadChannels();
      await handleFilterPosts();
    }, [handleScrapeChannel, loadChannels, handleFilterPosts]),
    summarizing,
    syncConcurrency
  );

  useEffect(() => {
    handleFilterPosts();
  }, [handleFilterPosts]);

  const scrapeChannelsInParallel = async (channelsToScrape: Channel[], source: string) => {
    console.log(`[SyncQueue] Adding ${channelsToScrape.length} channels to queue from ${source}`);
    
    const promises = channelsToScrape.map(channel => {
      return new Promise<void>((resolve) => {
        addToSyncQueue(channel, source, resolve);
      });
    });

    if (promises.length > 0) {
      await Promise.all(promises);
      console.log(`[SyncQueue] All channels from ${source} have been processed.`);
    }
  };

  const handleScrapeAll = async () => {
    if (channels.length === 0) {
      toast.error("Please add at least one channel first");
      return;
    }

    const channelsToScrape = channels.filter(c => !c.isFrozen);
    if (channelsToScrape.length === 0) {
      toast.info("All channels are frozen");
      return;
    }

    try {
      await scrapeChannelsInParallel(channelsToScrape, "Manual (Sync All)");
      
      await loadChannels();
      await handleFilterPosts();
      if (activeTab !== "channels") setActiveTab("posts");
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "An unexpected error occurred during scraping");
    }
  };

  const handleScrapeSelected = async () => {
    if (selectedChannels.size === 0) {
      toast.error("Please select at least one channel first");
      return;
    }

    const channelsToScrape = channels.filter(c => selectedChannels.has(c.name) && !c.isFrozen);
    if (channelsToScrape.length === 0) {
      toast.info("Selected channels are frozen");
      return;
    }

    try {
      await scrapeChannelsInParallel(channelsToScrape, "Manual (Sync Selected)");
      
      await loadChannels();
      await handleFilterPosts();
      if (activeTab !== "channels") setActiveTab("posts");
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "An unexpected error occurred during scraping");
    }
  };

  const addNewChannel = async (channelName: string, discoveredVia?: { channelName: string; postId: number; timestamp: number }) => {
    const cleanName = channelName.trim().replace(/^@/, '').split('/').pop() || "";
    if (!cleanName) return;
    
    // Check if already exists
    if (channels.some(c => c.name.toLowerCase() === cleanName.toLowerCase())) {
      toast.info(`Channel @${cleanName} is already in your workspace`);
      return;
    }

    let displayName = cleanName;
    let photoUrl = undefined;
    let isUnavailableOnWebView = false;
    const effectiveStartTime = getEffectiveGlobalStartTime();

    const proxies = proxyUrls.split(/[\n,]+/).map(p => p.trim()).filter(p => p);
    const torPool = torProxyUrls.split(/[\n,]+/).map(p => p.trim()).filter(p => p);
    
    let activeProxies: string[] = [];
    if (proxyEnabled) {
      activeProxies.push(...proxies);
    }
    
    if (torEnabled) {
      if (torMode === "auto") {
        activeProxies.push("socks5h://127.0.0.1:9050");
      } else {
        activeProxies.push(...torPool);
      }
    }

    try {
      const data = await api.channelInfo({
        channelName: cleanName,
        proxyEnabled: proxyEnabled || torEnabled,
        proxies: activeProxies,
        torAutoRotate,
        torRotationThreshold,
        torControlPort,
      }) as Record<string, unknown>;

      if (data.displayName) displayName = String(data.displayName);
      if (data.photoUrl) photoUrl = String(data.photoUrl);
      if (data.isUnavailableOnWebView) isUnavailableOnWebView = true;
      if (data.error && !data.isUnavailableOnWebView) {
        toast.error(String(data.error));
      }
    } catch (err: any) {
      console.error("Failed to fetch initial channel info:", err);
    } 

    const newChannel: Channel = {
      id: cleanName,
      name: cleanName,
      displayName,
      photoUrl,
      startTime: effectiveStartTime,
      lastUpdated: Date.now(),
      followedAt: Date.now(),
      tags: [],
      isFrozen: isUnavailableOnWebView,
      isUnavailableOnWebView,
      discoveredVia
    };
    
    await saveChannel(newChannel);
    await loadChannels();
    toast.success(`Added @${cleanName} to workspace`);
    
    // Optionally trigger a scrape immediately
    addToSyncQueue(newChannel, "Manual (Added from Forward)", () => {});
  };

  return (
    <ScraperContext.Provider value={{
      postSearch,
      setPostSearch,
      semanticSearchQuery,
      setSemanticSearchQuery,
      semanticSearchRespectsTimeRange,
      setSemanticSearchRespectsTimeRange,
      semanticSearchRespectsChannels,
      setSemanticSearchRespectsChannels,
      relatedPostSearch,
      setRelatedPostSearch,
      isFiltering,
      scrapingChannels,
      setScrapingChannels,
      filteredPosts,
      visiblePosts,
      setVisiblePosts,
      handleFilterPosts,
      setFilteredPosts,
      handleScrapeChannel,
      handleScrapeAll,
      handleScrapeSelected,
      scrapeChannelsInParallel,
      syncQueue,
      isProcessingQueue,
      addToSyncQueue,
      autoSyncPauseUntil,
      setAutoSyncPauseUntil,
      consecutiveFailures,
      setConsecutiveFailures,
      addNewChannel,
      forwardedFilter,
      setForwardedFilter
    }}>
      {children}
    </ScraperContext.Provider>
  );
};

export function useScraper() {
  const context = useContext(ScraperContext);
  if (context === undefined) {
    throw new Error("useScraper must be used within a ScraperProvider");
  }
  return context;
}
