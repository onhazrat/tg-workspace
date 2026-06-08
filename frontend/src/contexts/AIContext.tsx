import React, { createContext, useContext, useState, useRef, useEffect } from "react";
import { Summary, PublishLog, LLMLog, Post } from "../types";
import { saveSummary, getPostsByDateRange, savePublishLog, saveLLMLog } from "../lib/db";
import { useData } from "./DataContext";
import { toast } from "sonner";
import { useSettings } from "./SettingsContext";
import { useScraper } from "./ScraperContext";
import { useChatContext } from "./ChatContext";
import { useUI } from "./UIContext";
import { SYSTEM_PROMPT } from "../constants";
import { generateSummaryStream, generateSummary, AIServiceError } from "../services/ai";
import { publishSummary } from "../services/telegram";

const extractCitedPosts = (text: string, availablePosts: Post[]): Record<string, Post> => {
  const cited: Record<string, Post> = {};
  const regex = /\[([^\]]+?)\s*#(\d+)\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const channelName = match[1].trim();
    const postId = parseInt(match[2], 10);
    const key = `${channelName}-${postId}`;
    if (!cited[key]) {
      const post = availablePosts.find(p => p.channelName === channelName && p.id === postId);
      if (post) {
        cited[key] = post;
      }
    }
  }
  return cited;
};

export const generateDefaultMetadataText = (s: Summary): string => {
  return `📊 *Analysis Metadata*\n🕒 *Time Range:* ${new Date(s.startDate).toLocaleString()} - ${new Date(s.endDate).toLocaleString()}\n📡 *Channels Used:* ${s.channels?.length || 0}\n📋 *Channel List:* ${(s.channels || []).map(c => `@${c}`).join(', ')}\n🤖 *AI Model:* ${s.model || "gemini-3-flash-preview"}\n📝 *Posts Analyzed:* ${s.postCount || 0}`;
};

interface AIContextType {
  summary: string | null;
  setSummary: React.Dispatch<React.SetStateAction<string | null>>;
  regeneratingSummaries: Set<string>;
  copied: boolean;
  handleSummarize: () => Promise<void>;
  generateBackgroundSummary: (s: Summary, shiftTime?: boolean) => Promise<void>;
  copyToClipboard: () => void;
}

const AIContext = createContext<AIContextType | undefined>(undefined);

export const AIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { channels, selectedChannels, loadHistory, summariesHistory, botCredentials, chatDestinations, loadLLMLogs } = useData();
  const { startDate, endDate, setActiveTab, summarizing, setSummarizing, currentSummaryId, setCurrentSummaryId } = useUI();
  const { 
    aiLanguage, 
    selectedModel, 
    aiTemperature,
    proxyEnabled, 
    proxyUrls, 
    torEnabled, 
    torMode, 
    torProxyUrls, 
    torAutoRotate, 
    torRotationThreshold, 
    torControlPort, 
    torControlPassword 
  } = useSettings();
  const { filteredPosts, scrapeChannelsInParallel, postSearch, semanticSearchQuery, semanticSearchRespectsTimeRange, semanticSearchRespectsChannels, handleFilterPosts } = useScraper();
  const { setChatMessages } = useChatContext();

  const [summary, setSummary] = useState<string | null>(null);
  const [regeneratingSummaries, setRegeneratingSummaries] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  const getActiveProxies = () => {
    const proxies = proxyUrls.split(/[\n,]+/).map(p => p.trim()).filter(p => p);
    const torPool = torProxyUrls.split(/[\n,]+/).map(p => p.trim()).filter(p => p);
    
    let activeProxies: string[] = [];
    if (proxyEnabled) activeProxies.push(...proxies);
    if (torEnabled) {
      if (torMode === "auto") {
        activeProxies.push("socks5h://127.0.0.1:9050");
      } else {
        activeProxies.push(...torPool);
      }
    }
    return activeProxies;
  };

  const autoRegenerateDataRef = useRef({
    summariesHistory,
    regeneratingSummaries,
    generateBackgroundSummary: (s: Summary, shiftTime?: boolean) => Promise.resolve()
  });

  useEffect(() => {
    autoRegenerateDataRef.current = {
      summariesHistory,
      regeneratingSummaries,
      generateBackgroundSummary
    };
  });

  // Auto-regenerate summaries: server scheduler (Phase 4) handles always-on;
  // client tick retained for responsiveness when UI is open.
  useEffect(() => {
    const CHECK_INTERVAL_MS = 60 * 1000;
    const intervalId = setInterval(() => {
      const {
        summariesHistory: currentHistory,
        regeneratingSummaries: currentRegenerating,
        generateBackgroundSummary: currentGenerate,
      } = autoRegenerateDataRef.current;
      const now = Date.now();
      currentHistory.forEach((s) => {
        if (s.autoRegenerate && !currentRegenerating.has(s.id)) {
          const durationMs = s.endDate - s.startDate;
          if (durationMs < 60 * 1000) return;
          const targetTime = s.endDate + durationMs;
          if (now >= targetTime) currentGenerate(s);
        }
      });
    }, CHECK_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, []);

  const handleSummarize = async () => {
    const now = Date.now();
    const targetTs = Math.min(endDate, now);
    
    const channelsToSync = channels.filter(c => 
      selectedChannels.has(c.name) && 
      (!c.lastUpdated || c.lastUpdated < targetTs - 60000) // 1 minute buffer
    );

    let postsToSummarize = filteredPosts;

    if (channelsToSync.length > 0) {
      toast.info(`Syncing ${channelsToSync.length} channels to ensure up-to-date data...`);
      await scrapeChannelsInParallel(channelsToSync, "Pre-Summary Sync");
      
      // Fetch updated posts
      const selectedNames = Array.from(selectedChannels);
      let posts = await getPostsByDateRange(selectedNames, startDate, endDate);
      
      if (postSearch.trim()) {
        const query = postSearch.toLowerCase();
        posts = posts.filter(post => 
          post.text.toLowerCase().includes(query) || 
          post.channelName.toLowerCase().includes(query)
        );
      }
      
      postsToSummarize = posts.sort((a, b) => b.timestamp - a.timestamp);
      
      // Also update the UI state
      handleFilterPosts();
    }

    if (postsToSummarize.length === 0) {
      toast.error("No posts found in the selected date range. Try scraping first.");
      return;
    }

    setSummarizing(true);
    setSummary(null);
    setActiveTab("summary");

    try {
      const postsText = postsToSummarize
        .map((p) => `[${p.channelName}] ID: ${p.id}\nDate: ${p.date}\nContent: ${p.text}`)
        .join("\n\n---\n\n");

      const startTime = Date.now();
      const { stream, prompt, config } = await generateSummaryStream(
        channels.map(c => c.name),
        postsText,
        aiLanguage,
        selectedModel,
        aiTemperature
      );

      let fullSummaryText = "";
      let lastResponse: { usageMetadata?: { totalTokenCount?: number } } | null = null;
      setChatMessages([]); // Clear chat when new summary starts
      
      for await (const chunk of stream) {
        const chunkText = chunk.text || "";
        fullSummaryText += chunkText;
        setSummary(fullSummaryText);
        lastResponse = chunk as { usageMetadata?: { totalTokenCount?: number } };
      }

      const duration = Date.now() - startTime;

      // Log LLM Interaction
      const llmLog: LLMLog = {
        id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
        model: selectedModel,
        prompt: prompt,
        response: fullSummaryText,
        modelConfig: config,
        fullRequest: { contents: [{ parts: [{ text: prompt }] }], config },
        fullResponse: lastResponse,
        tokens: lastResponse?.usageMetadata?.totalTokenCount,
        status: fullSummaryText ? "success" : "failed",
        timestamp: Date.now(),
        duration: duration,
        type: "summary"
      };
      await saveLLMLog(llmLog);
      await loadLLMLogs();

      if (fullSummaryText) {
        const newId = Date.now().toString();
        
        const citedPosts = extractCitedPosts(fullSummaryText, postsToSummarize);
        
        const newSummary: Summary = {
          id: newId,
          text: fullSummaryText,
          channels: Array.from(selectedChannels),
          startDate,
          endDate,
          language: aiLanguage,
          model: selectedModel,
          postCount: filteredPosts.length,
          timestamp: Date.now(),
          sendMetadata: true,
          postSearch: postSearch || undefined,
          semanticSearchQuery: semanticSearchQuery || undefined,
          semanticSearchRespectsTimeRange,
          semanticSearchRespectsChannels,
          citedPosts
        };
        await saveSummary(newSummary);
        setCurrentSummaryId(newId);
        await loadHistory();
      }
    } catch (err: unknown) {
      console.error(err);
      if (err instanceof AIServiceError) {
        toast.error(err.message);
      } else if (err instanceof Error) {
        toast.error(err.message);
      } else {
        toast.error("An unexpected error occurred during summarization");
      }
    } finally {
      setSummarizing(false);
    }
  };

  const generateBackgroundSummary = async (s: Summary, shiftTime: boolean = true) => {
    setRegeneratingSummaries(prev => new Set(prev).add(s.id));
    try {
      let newStartDate = s.startDate;
      let newEndDate = s.endDate;

      if (shiftTime) {
        const durationMs = s.endDate - s.startDate;
        newStartDate = s.endDate;
        newEndDate = s.endDate + durationMs;
      }
      
      const newEndDateTimestamp = newEndDate;
      
      // Sync channels first - only if they haven't been updated since the new summary's end date
      const channelsToSync = channels.filter(c => {
        if (!s.channels.includes(c.name)) return false;
        const lastUpdated = c.lastUpdated || 0;
        return lastUpdated < newEndDateTimestamp;
      });

      if (channelsToSync.length > 0) {
        await scrapeChannelsInParallel(channelsToSync, `Auto-Regenerate Summary (${s.id})`);
      }
      
      const posts = await getPostsByDateRange(s.channels, newStartDate, newEndDate);
      
      let fullSummaryText = "";
      if (posts.length === 0) {
        fullSummaryText = `No new posts found in the selected channels between ${new Date(newStartDate).toLocaleString()} and ${new Date(newEndDate).toLocaleString()}.`;
      } else {
        const postsText = posts
          .map((p) => `[${p.channelName}] ID: ${p.id}\nDate: ${p.date}\nContent: ${p.text}`)
          .join("\n\n---\n\n");

        const startTime = Date.now();
        const result = await generateSummary(
          s.channels,
          postsText,
          s.language,
          s.model || "gemini-3-flash-preview",
          aiTemperature
        );
        fullSummaryText = result.text;
        const { prompt, config, fullResponse } = result;
        const duration = Date.now() - startTime;

        // Log LLM Interaction
        const llmLog: LLMLog = {
          id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
          model: s.model || "gemini-3-flash-preview",
          prompt: prompt,
          response: fullSummaryText,
          modelConfig: config,
          fullRequest: { contents: [{ parts: [{ text: prompt }] }], config },
          fullResponse: fullResponse,
          tokens: fullResponse?.usageMetadata?.totalTokenCount,
          status: "success",
          timestamp: Date.now(),
          duration: duration,
          type: "summary"
        };
        await saveLLMLog(llmLog);
        await loadLLMLogs();
      }

      const newId = Date.now().toString();
      
      const citedPosts = extractCitedPosts(fullSummaryText, posts);
      
      const newSummary: Summary = {
        id: newId,
        text: fullSummaryText,
        channels: s.channels,
        startDate: newStartDate,
        endDate: newEndDate,
        language: s.language,
        model: s.model,
        postCount: posts.length,
        timestamp: Date.now(),
        autoRegenerate: true,
        autoPublish: s.autoPublish,
        publishBotId: s.publishBotId,
        publishChatId: s.publishChatId,
        sendMetadata: s.sendMetadata !== undefined ? s.sendMetadata : true,
        postSearch: s.postSearch,
        semanticSearchQuery: s.semanticSearchQuery,
        semanticSearchRespectsTimeRange: s.semanticSearchRespectsTimeRange,
        semanticSearchRespectsChannels: s.semanticSearchRespectsChannels,
        citedPosts
      };
      await saveSummary(newSummary);
      
      // Auto-publish if enabled
      if (s.autoPublish && s.publishBotId && s.publishChatId && posts.length > 0) {
        const bot = botCredentials.find(b => b.id === s.publishBotId);
        const dest = chatDestinations.find(d => d.id === s.publishChatId);
        if (bot && dest) {
          const activeProxies = getActiveProxies();
          const generatedMetadata = generateDefaultMetadataText(newSummary);
          const result = await publishSummary(
            bot.token, 
            dest.chatId, 
            fullSummaryText,
            newSummary.sendMetadata ? (newSummary.metadataText || generatedMetadata) : undefined,
            activeProxies.length > 0,
            activeProxies,
            torAutoRotate,
            torRotationThreshold,
            torControlPort,
            torControlPassword
          );
          
          // Log the result
          const log: PublishLog = {
            id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
            summaryId: newId,
            botId: bot.id,
            botName: bot.name,
            chatId: dest.chatId,
            chatName: dest.name,
            status: result.success ? "success" : "failed",
            error: result.error,
            timestamp: Date.now(),
            fullRequest: result.requests,
            fullResponse: result.responses,
            textSent: newSummary.sendMetadata ? `${newSummary.metadataText || generatedMetadata}\n\n${fullSummaryText}` : fullSummaryText
          };
          await savePublishLog(log);
          
          if (result.success) {
            toast.success(`Auto-published summary to ${dest.name}`);
          } else {
            console.error("Auto-publish failed:", result.error);
            toast.error(`Auto-publish failed: ${result.error}`);
          }
        }
      }
      
      // Update the old summary to not auto-regenerate anymore
      const oldSummary = { ...s, autoRegenerate: false };
      await saveSummary(oldSummary);
      
      await loadHistory();
    } catch (err: unknown) {
      let errorMessage = err instanceof Error ? err.message : "Unknown error";
      let isQuotaExceeded = false;
      
      try {
        if (errorMessage.startsWith('{') && errorMessage.endsWith('}')) {
          const parsed = JSON.parse(errorMessage);
          if (parsed.error && parsed.error.message) {
            errorMessage = parsed.error.message;
            if (parsed.error.code === 429) {
              isQuotaExceeded = true;
            }
          }
        } else if (
          errorMessage.includes('429') || 
          errorMessage.includes('RESOURCE_EXHAUSTED') ||
          errorMessage.toLowerCase().includes('quota') ||
          errorMessage.toLowerCase().includes('rate limit')
        ) {
          isQuotaExceeded = true;
        }
      } catch (e) {
        // Ignore parse errors
      }

      console.error("Failed to generate background summary:", err);
      toast.error(`Failed to generate background summary: ${errorMessage}`);
      
      if (isQuotaExceeded) {
        // Disable auto-regenerate to prevent spamming the API
        const oldSummary = { ...s, autoRegenerate: false };
        await saveSummary(oldSummary);
        await loadHistory();
      }
    } finally {
      setRegeneratingSummaries(prev => {
        const next = new Set(prev);
        next.delete(s.id);
        return next;
      });
    }
  };

  const copyToClipboard = () => {
    if (summary) {
      navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <AIContext.Provider value={{
      summary,
      setSummary,
      regeneratingSummaries,
      copied,
      handleSummarize,
      generateBackgroundSummary,
      copyToClipboard
    }}>
      {children}
    </AIContext.Provider>
  );
};

export function useAI() {
  const context = useContext(AIContext);
  if (context === undefined) {
    throw new Error("useAI must be used within an AIProvider");
  }
  return context;
}
