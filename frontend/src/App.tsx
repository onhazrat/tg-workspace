import { useRef, useEffect } from "react";
import { HelpCircle, Database, List, MessageSquare, Settings, History, Send, AlertCircle, Moon, Sun, AlertTriangle, Sparkles, FileText, Activity } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Summary, TabType } from "./types";
import { WORKSPACE_TABS, isPastedSummaryModel, isPendingSummary } from "./constants";
import { useSettings } from "./contexts/SettingsContext";
import { useData } from "./contexts/DataContext";
import { useUI } from "./contexts/UIContext";
import { useScraper } from "./contexts/ScraperContext";
import { useAI } from "./contexts/AIContext";
import { useChatContext } from "./contexts/ChatContext";
import { ChannelGrid } from "./components/ChannelGrid";
import { PostFeed } from "./components/PostFeed";
import { SummaryView } from "./components/SummaryView";
import { ChatView } from "./components/ChatView";
import { SettingsHub } from "./components/SettingsHub";
import { HistoryView } from "./components/HistoryView";
import { api } from "@/api";
import { useApiStatus } from "./hooks/useApiStatus";
import { RelativeTime } from "./components/RelativeTime";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/ui/tg-tooltip";
import { useGuidedTour } from "./hooks/useGuidedTour";

export default function App() {
  const { isOffline } = useApiStatus();

  const {
    channels,
    selectedChannels,
    setSelectedChannels,
  } = useData();

  const {
    activeTab, setActiveTab,
    isRateLimited, setIsRateLimited,
    startDate, endDate,
    setDateRange,
    summarizing,
    setCurrentSummaryId
  } = useUI();

  const {
    postSearch, setPostSearch,
    setSemanticSearchQuery,
    setSemanticSearchRespectsTimeRange,
    setSemanticSearchRespectsChannels,
    setRelatedPostSearch,
    filteredPosts,
    autoSyncPauseUntil,
    setAutoSyncPauseUntil,
  } = useScraper();

  const {
    setChatMessages,
  } = useChatContext();

  const {
    setSummary,
  } = useAI();

  const loadMoreRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const {
    theme,
    setTheme,
    aiLanguage,
    setAiLanguage,
    selectedModel,
    setSelectedModel,
    proxyEnabled,
    torEnabled,
  } = useSettings();

  const { startTour } = useGuidedTour();

  // Poll server job status for auto-sync pause banner (Phase 6 scheduler).
  useEffect(() => {
    if (isOffline) return;

    const refreshPauseState = async () => {
      try {
        const status = await api.jobsStatus();
        const pauseUntil = status.auto_sync?.pauseUntil ?? null;
        setAutoSyncPauseUntil(pauseUntil);
      } catch (err) {
        console.error("[App] Failed to fetch job status:", err);
      }
    };

    refreshPauseState();
    const intervalId = setInterval(refreshPauseState, 30_000);
    return () => clearInterval(intervalId);
  }, [isOffline, setAutoSyncPauseUntil]);

  const toggleTheme = () => {
    setTheme(theme === "light" ? "dark" : "light");
  };

  const handleSelectHistorySummary = (s: Summary) => {
    setSummary(isPendingSummary(s) ? null : s.text);
    setDateRange(s.startDate, s.endDate);
    setAiLanguage(s.language);
    if (s.model && !isPastedSummaryModel(s.model)) setSelectedModel(s.model);
    setSelectedChannels(new Set(s.channels || []));
    setChatMessages(s.chatMessages || []);
    setCurrentSummaryId(s.id);
    setPostSearch(s.postSearch || "");
    setSemanticSearchQuery(s.semanticSearchQuery || "");
    setSemanticSearchRespectsTimeRange(s.semanticSearchRespectsTimeRange || false);
    setSemanticSearchRespectsChannels(s.semanticSearchRespectsChannels || false);
    setRelatedPostSearch(null);
    
    // If it's a chat-only session, go to chat tab
    if (s.text.startsWith("Chat: ") && (!s.chatMessages || s.chatMessages.length > 0)) {
      setActiveTab("chat");
    } else {
      setActiveTab("summary");
    }
  };

  return (
    <div className={`min-h-screen bg-app-bg text-app-ink font-sans selection:bg-app-ink selection:text-app-bg transition-colors duration-300 flex flex-col`}>
      <main className="flex-1 flex flex-col p-4 md:p-8 max-w-7xl mx-auto w-full">
        {/* Offline Banner */}
        <AnimatePresence>
          {isOffline && (
            <motion.div
              initial={{ height: 0, opacity: 0, marginBottom: 0 }}
              animate={{ height: 'auto', opacity: 1, marginBottom: 16 }}
              exit={{ height: 0, opacity: 0, marginBottom: 0 }}
              className="bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 px-4 py-3 flex items-center gap-3 text-xs rounded-md overflow-hidden"
            >
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                <strong className="uppercase tracking-wider">Server offline.</strong> Showing cached data. Sync, summary, and publish actions are disabled.
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Auto-Sync Paused Banner */}
        <AnimatePresence>
          {autoSyncPauseUntil && Date.now() < autoSyncPauseUntil && (
            <motion.div
              initial={{ height: 0, opacity: 0, marginBottom: 0 }}
              animate={{ height: 'auto', opacity: 1, marginBottom: 16 }}
              exit={{ height: 0, opacity: 0, marginBottom: 0 }}
              className="bg-red-500/10 border border-red-500/20 text-red-500 px-4 py-3 flex items-center justify-between text-xs rounded-md overflow-hidden"
            >
              <div className="flex items-center gap-3">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>
                  <strong className="uppercase tracking-wider">Auto-sync paused.</strong> Multiple channels failed to update. Auto-sync will resume in <RelativeTime timestamp={autoSyncPauseUntil} />.
                </span>
              </div>
              <button 
                onClick={async () => {
                  try {
                    await api.putSetting("sync", {
                      autoSyncPauseUntil: null,
                      consecutiveFailures: 0,
                    });
                    setAutoSyncPauseUntil(null);
                  } catch (err) {
                    console.error("[App] Failed to resume auto-sync:", err);
                  }
                }}
                className="px-3 py-1.5 hover:bg-red-500/10 rounded transition-colors font-medium font-mono uppercase tracking-widest text-[10px] whitespace-nowrap"
              >
                Resume Now
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Content Area */}
        <div className="w-full flex-1 flex flex-col">
          <div className="flex flex-col sm:flex-row justify-between items-end mb-4 gap-4">
            <div>
              <h1 className="text-xl font-bold tracking-tighter uppercase leading-none">Telegram Summarizer</h1>
              <p className="text-[11px] text-app-ink/50 font-mono mt-1">Technical Scraper & AI Analyst v1.0</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden sm:flex items-center gap-3 text-[11px] font-mono uppercase tracking-widest text-app-ink/50">
                <span>Routing: {torEnabled ? 'Tor' : proxyEnabled ? 'Proxy' : 'Direct'}</span>
                <span className={`w-1 h-1 rounded-full animate-pulse ${torEnabled ? 'bg-green-500' : proxyEnabled ? 'bg-purple-500' : 'bg-blue-500'}`}></span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button 
                    id="tour-help-button"
                    onClick={startTour}
                    className="p-1.5 border border-app-ink border-opacity-10 hover:border-opacity-40 transition-all rounded-md"
                  >
                    <HelpCircle size={14} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Replay Guided Tour</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button 
                    onClick={toggleTheme}
                    className="p-1.5 border border-app-ink border-opacity-10 hover:border-opacity-40 transition-all rounded-md"
                  >
                    {theme === "light" ? <Moon size={14} /> : <Sun size={14} />}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {isRateLimited && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mb-6 bg-red-500 text-white p-3 flex items-center justify-center gap-3 font-bold uppercase tracking-tighter text-xs animate-pulse"
            >
              <AlertTriangle size={16} />
              Telegram Rate Limit Active - Retrying with exponential backoff...
            </motion.div>
          )}

          <div className="border border-app-ink border-opacity-20 flex flex-col bg-app-card flex-1 overflow-hidden">
            <div className="border-b border-app-ink border-opacity-10 p-4 flex flex-col gap-4 bg-app-muted shrink-0">
              <div className="flex justify-between items-center">
                <div className="flex gap-4">
                  {WORKSPACE_TABS.map((tab) => {
                    const Icon = {
                      Database,
                      List,
                      MessageSquare,
                      History,
                      Send,
                      Settings,
                      Sparkles,
                      FileText,
                      Activity,
                    }[tab.icon] || Database;

                    return (
                      <button
                        key={tab.id}
                        id={`tour-tab-${tab.id}`}
                        onClick={() => setActiveTab(tab.id as TabType)}
                        className={`text-xs font-mono uppercase tracking-widest flex items-center gap-2 pb-1 border-b-2 transition-all ${
                          activeTab === tab.id ? "border-app-ink opacity-100" : "border-transparent opacity-40"
                        }`}
                      >
                        <Icon size={14} /> {tab.label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-6">
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-app-ink/50 mb-0.5">Last Sync</span>
                      <span className="text-xs font-medium tracking-tighter leading-none font-mono">
                        {(() => {
                          const selected = channels.filter(c => selectedChannels.has(c.name) && !c.isFrozen);
                          if (selected.length === 0) return "—";
                          const minTime = Math.min(...selected.map(c => c.lastUpdated || 0));
                          return <RelativeTime timestamp={minTime} />;
                        })()}
                      </span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-app-ink/50 mb-0.5">Active Channels</span>
                      <span className="text-xs font-medium tracking-tighter leading-none font-mono">{selectedChannels.size}</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-app-ink/50 mb-0.5">Posts in Scope</span>
                      <span className="text-xs font-medium tracking-tighter text-app-ink leading-none font-mono">{filteredPosts.length.toLocaleString()}</span>
                    </div>
                    <button
                      onClick={() => setActiveTab("settings")}
                      className={`p-2 border rounded-md transition-all ml-2 ${
                        activeTab === "settings"
                          ? "bg-app-ink text-app-bg border-app-ink"
                          : "border-app-ink/20 opacity-60 hover:opacity-100 hover:bg-app-ink/5"
                      }`}
                      title="Settings & Engine Room"
                    >
                      <Settings size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
            
            <div ref={scrollContainerRef} className="flex-1 p-8 overflow-y-auto">
              <AnimatePresence mode="wait">
                {summarizing ? (
                  <motion.div
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-full flex flex-col items-center justify-center text-center space-y-4"
                  >
                    <div className="w-12 h-12 border-2 border-app-ink border-t-transparent rounded-full animate-spin"></div>
                    <div className="space-y-1">
                      <p className="text-xs font-mono uppercase tracking-widest animate-pulse">
                        Generating Summary
                      </p>
                      <p className="text-[10px] opacity-40 italic serif">
                        AI is analyzing content...
                      </p>
                    </div>
                  </motion.div>
                ) : activeTab === "history" ? (
                  <HistoryView
                    handleSelectHistorySummary={handleSelectHistorySummary}
                    setActiveTab={setActiveTab}
                  />
                ) : activeTab === "chat" ? (
                  <ChatView />
                ) : activeTab === "channels" ? (
                  <ChannelGrid />
                ) : activeTab === "summary" ? (
                  <SummaryView />
                ) : activeTab === "settings" ? (
                  <SettingsHub />
                ) : (
                  <PostFeed
                    postSearch={postSearch}
                    setPostSearch={setPostSearch}
                    loadMoreRef={loadMoreRef}
                    scrollContainerRef={scrollContainerRef}
                  />
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </main>

    </div>
  );
}
