import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Command as CommandIcon,
  Database,
  FileText,
  HelpCircle,
  History,
  Keyboard,
  List,
  MessageSquare,
  Monitor,
  Moon,
  Send,
  Settings,
  Sparkles,
  Sun,
  Tag,
} from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useEffect, useRef, useState } from "react"
import { api } from "@/api"
import { ChannelGrid } from "./components/ChannelGrid"
import { ChatView } from "./components/ChatView"
import { useCommandPaletteContext } from "./components/CommandPaletteProvider"
import { HistoryView } from "./components/HistoryView"
import { PostFeed } from "./components/PostFeed"
import { RelativeTime } from "./components/RelativeTime"
import { SettingsHub } from "./components/SettingsHub"
import { SummaryView } from "./components/SummaryView"
import { TagView } from "./components/TagView"
import { getNextTheme } from "./components/theme-provider"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./components/ui/tg-tooltip"
import { WORKSPACE_TABS } from "./constants"
import { useAI } from "./contexts/AIContext"
import { useChatContext } from "./contexts/ChatContext"
import { useData } from "./contexts/DataContext"
import { useScraper } from "./contexts/ScraperContext"
import { useSettings } from "./contexts/SettingsContext"
import { useUI } from "./contexts/UIContext"
import { useApiStatus } from "./hooks/useApiStatus"
import { useGuidedTour } from "./hooks/useGuidedTour"
import { applyHistorySummarySelection } from "./lib/commands/history-selection"
import type { Summary, TabType } from "./types"

export default function App() {
  const { isOffline } = useApiStatus()

  const { channels, selectedChannels, setSelectedChannels } = useData()

  const {
    activeTab,
    setActiveTab,
    isRateLimited,
    setDateRange,
    summarizing,
    setCurrentSummaryId,
  } = useUI()

  const {
    postSearch,
    setPostSearch,
    setSemanticSearchQuery,
    setSemanticSearchRespectsTimeRange,
    setSemanticSearchRespectsChannels,
    setRelatedPostSearch,
    filteredPosts,
    autoSyncPauseUntil,
    setAutoSyncPauseUntil,
  } = useScraper()

  const { setChatMessages } = useChatContext()

  const { setSummary } = useAI()

  const loadMoreRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  const {
    theme,
    setTheme,
    setAiLanguage,
    setSelectedModel,
    proxyEnabled,
    torEnabled,
  } = useSettings()

  const { startTour } = useGuidedTour()
  const { setOpen: setCommandPaletteOpen } = useCommandPaletteContext()

  // Poll server job status for auto-sync pause banner (Phase 6 scheduler).
  useEffect(() => {
    if (isOffline) return

    const refreshPauseState = async () => {
      try {
        const status = await api.jobsStatus()
        const pauseUntil = status.auto_sync?.pauseUntil ?? null
        setAutoSyncPauseUntil(pauseUntil)
      } catch (err) {
        console.error("[App] Failed to fetch job status:", err)
      }
    }

    refreshPauseState()
    const intervalId = setInterval(refreshPauseState, 30_000)
    return () => clearInterval(intervalId)
  }, [isOffline, setAutoSyncPauseUntil])

  const toggleTheme = () => {
    setTheme(getNextTheme(theme))
  }

  const themeIcon =
    theme === "system" ? (
      <Monitor size={14} />
    ) : theme === "light" ? (
      <Moon size={14} />
    ) : (
      <Sun size={14} />
    )

  const themeTooltip =
    theme === "system"
      ? "System theme (follows OS) — click for Light"
      : theme === "light"
        ? "Switch to Dark Mode"
        : "Switch to System Mode"

  const handleSelectHistorySummary = (s: Summary) => {
    applyHistorySummarySelection(s, {
      setActiveTab,
      setDateRange,
      setSelectedChannels,
      setChatMessages,
      setCurrentSummaryId,
      setPostSearch,
      setSemanticSearchQuery,
      setSemanticSearchRespectsTimeRange,
      setSemanticSearchRespectsChannels,
      setRelatedPostSearch,
      setSummary,
      settings: {
        setAiLanguage,
        setSelectedModel,
      },
    })
  }

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      if (target.isContentEditable) return true
      const tag = target.tagName
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return
      if (isEditableTarget(event.target)) return
      if (event.key !== "?") return
      event.preventDefault()
      setShortcutsOpen(true)
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const commandKey =
    typeof navigator !== "undefined" &&
    /(Mac|iPhone|iPad|iPod)/i.test(navigator.platform)
      ? "Cmd"
      : "Ctrl"

  return (
    <div
      className={`tg-wcag-floor h-svh overflow-hidden bg-app-bg text-app-ink font-sans selection:bg-app-ink selection:text-app-bg transition-colors duration-300 flex flex-col`}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-app-card focus:px-3 focus:py-2 focus:text-xs focus:font-mono focus:uppercase focus:tracking-widest focus:text-app-ink focus:outline-none focus:ring-2 focus:ring-app-ink"
      >
        Skip to content
      </a>
      <main
        id="main-content"
        className="app-shell flex min-h-0 flex-1 flex-col p-4 md:p-8"
      >
        {/* Offline Banner */}
        <AnimatePresence>
          {isOffline && (
            <motion.div
              initial={{ height: 0, opacity: 0, marginBottom: 0 }}
              animate={{ height: "auto", opacity: 1, marginBottom: 16 }}
              exit={{ height: 0, opacity: 0, marginBottom: 0 }}
              className="bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 px-4 py-3 flex items-center gap-3 text-xs rounded-md overflow-hidden"
            >
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                <strong className="uppercase tracking-wider">
                  Server offline.
                </strong>{" "}
                Showing cached data. Sync, summary, and publish actions are
                disabled.
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Auto-Sync Paused Banner */}
        <AnimatePresence>
          {autoSyncPauseUntil && Date.now() < autoSyncPauseUntil && (
            <motion.div
              initial={{ height: 0, opacity: 0, marginBottom: 0 }}
              animate={{ height: "auto", opacity: 1, marginBottom: 16 }}
              exit={{ height: 0, opacity: 0, marginBottom: 0 }}
              className="bg-red-500/10 border border-red-500/20 text-red-500 px-4 py-3 flex items-center justify-between text-xs rounded-md overflow-hidden"
            >
              <div className="flex items-center gap-3">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>
                  <strong className="uppercase tracking-wider">
                    Auto-sync paused.
                  </strong>{" "}
                  Multiple channels failed to update. Auto-sync will resume in{" "}
                  <RelativeTime timestamp={autoSyncPauseUntil} />.
                </span>
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await api.putSetting("sync", {
                      autoSyncPauseUntil: null,
                      consecutiveFailures: 0,
                    })
                    setAutoSyncPauseUntil(null)
                  } catch (err) {
                    console.error("[App] Failed to resume auto-sync:", err)
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
        <div className="w-full flex min-h-0 flex-1 flex-col">
          <div className="flex flex-col sm:flex-row justify-between items-end mb-4 gap-4">
            <div>
              <h1 className="text-xl font-bold tracking-tighter uppercase leading-none">
                Telegram Summarizer
              </h1>
              <p className="text-[11px] text-app-ink/50 font-mono mt-1">
                Technical Scraper & AI Analyst v1.0
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden sm:flex items-center gap-3 text-[11px] font-mono uppercase tracking-widest text-app-ink/50">
                <span>
                  Routing:{" "}
                  {torEnabled ? "Tor" : proxyEnabled ? "Proxy" : "Direct"}
                </span>
                <span
                  className={`w-1 h-1 rounded-full animate-pulse ${torEnabled ? "bg-green-500" : proxyEnabled ? "bg-purple-500" : "bg-blue-500"}`}
                />
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    id="command-palette-button"
                    data-testid="command-palette-button"
                    onClick={() => setCommandPaletteOpen(true)}
                    className="p-1.5 border border-app-ink border-opacity-10 hover:border-opacity-40 transition-all rounded-md"
                  >
                    <CommandIcon size={14} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Command Palette (⌘⇧P)</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
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
                    type="button"
                    onClick={() => setShortcutsOpen(true)}
                    className="p-1.5 border border-app-ink border-opacity-10 hover:border-opacity-40 transition-all rounded-md"
                  >
                    <Keyboard size={14} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Keyboard Shortcuts (?)</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={toggleTheme}
                    className="p-1.5 border border-app-ink border-opacity-10 hover:border-opacity-40 transition-all rounded-md"
                  >
                    {themeIcon}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{themeTooltip}</p>
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

          <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
            <DialogContent className="border-app-ink/20 bg-app-card p-0 text-app-ink sm:max-w-xl">
              <DialogHeader className="border-b border-app-ink/10 p-4">
                <DialogTitle className="text-lg font-bold tracking-tight uppercase">
                  Keyboard Shortcuts
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-2 p-4 text-xs font-mono uppercase tracking-widest">
                <div className="flex items-center justify-between rounded-md border border-app-ink/10 bg-app-muted/30 px-3 py-2">
                  <span>Command Palette</span>
                  <code>{commandKey}+Shift+P</code>
                </div>
                <div className="flex items-center justify-between rounded-md border border-app-ink/10 bg-app-muted/30 px-3 py-2">
                  <span>Keyboard Shortcuts</span>
                  <code>?</code>
                </div>
                <div className="flex items-center justify-between rounded-md border border-app-ink/10 bg-app-muted/30 px-3 py-2">
                  <span>Run Highlighted Command</span>
                  <code>Enter</code>
                </div>
                <div className="flex items-center justify-between rounded-md border border-app-ink/10 bg-app-muted/30 px-3 py-2">
                  <span>Alternate Run Command</span>
                  <code>{commandKey}+Enter</code>
                </div>
                <div className="flex items-center justify-between rounded-md border border-app-ink/10 bg-app-muted/30 px-3 py-2">
                  <span>Back / Close Sub-View</span>
                  <code>Esc</code>
                </div>
                <div className="flex items-center justify-between rounded-md border border-app-ink/10 bg-app-muted/30 px-3 py-2">
                  <span>Parent Sub-View</span>
                  <code>Backspace (empty)</code>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <div className="border border-app-ink border-opacity-20 flex min-h-0 flex-1 flex-col bg-app-card overflow-hidden">
            <div className="border-b border-app-ink border-opacity-10 p-4 flex flex-col gap-4 bg-app-muted shrink-0">
              <div className="flex justify-between items-center">
                <div className="flex gap-4">
                  {WORKSPACE_TABS.map((tab) => {
                    const Icon =
                      {
                        Database,
                        List,
                        MessageSquare,
                        History,
                        Send,
                        Settings,
                        Sparkles,
                        FileText,
                        Activity,
                        Tag,
                      }[tab.icon] || Database

                    return (
                      <button
                        type="button"
                        key={tab.id}
                        id={`tour-tab-${tab.id}`}
                        onClick={() => setActiveTab(tab.id as TabType)}
                        className={`text-xs font-mono uppercase tracking-widest flex items-center gap-2 pb-1 border-b-2 transition-all ${
                          activeTab === tab.id
                            ? "border-app-ink opacity-100"
                            : "border-transparent opacity-40"
                        }`}
                      >
                        <Icon size={14} /> {tab.label}
                      </button>
                    )
                  })}
                </div>
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-6">
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-app-ink/50 mb-0.5">
                        Last Sync
                      </span>
                      <span className="text-xs font-medium tracking-tighter leading-none font-mono">
                        {(() => {
                          const selected = channels.filter(
                            (c) => selectedChannels.has(c.name) && !c.isFrozen,
                          )
                          if (selected.length === 0) return "—"
                          const minTime = Math.min(
                            ...selected.map((c) => c.lastUpdated || 0),
                          )
                          return <RelativeTime timestamp={minTime} />
                        })()}
                      </span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-app-ink/50 mb-0.5">
                        Active Channels
                      </span>
                      <span className="text-xs font-medium tracking-tighter leading-none font-mono">
                        {selectedChannels.size}
                      </span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-app-ink/50 mb-0.5">
                        Posts in Scope
                      </span>
                      <span className="text-xs font-medium tracking-tighter text-app-ink leading-none font-mono">
                        {filteredPosts.length.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div
              ref={scrollContainerRef}
              data-testid="workspace-scroll"
              className="min-h-0 flex-1 overflow-y-auto p-8"
            >
              <AnimatePresence mode="wait">
                {summarizing ? (
                  <motion.div
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-full flex flex-col items-center justify-center text-center space-y-4"
                  >
                    <div className="w-12 h-12 border-2 border-app-ink border-t-transparent rounded-full animate-spin" />
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
                  <ChannelGrid scrollContainerRef={scrollContainerRef} />
                ) : activeTab === "tag" ? (
                  <TagView />
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
  )
}
