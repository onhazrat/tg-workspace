import { Link } from "@tanstack/react-router"
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Command as CommandIcon,
  Compass,
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
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { api } from "@/api"
import { ChannelGrid } from "./components/ChannelGrid"
import { ChatView } from "./components/ChatView"
import { useCommandPaletteContext } from "./components/CommandPaletteProvider"
import { DiscoverView } from "./components/DiscoverView"
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
import { useScopedPostCounts } from "./hooks/usePostsView"
import { APP_VERSION } from "./lib/app-version"
import { applyHistorySummarySelection } from "./lib/commands/history-selection"
import {
  isEmptyScope,
  type RestoredScope,
  restoredScopeNotice,
} from "./lib/history/restored-scope-notice"
import { getSummary } from "./lib/repository"
import type { SummaryListItem, TabType } from "./types"

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
    autoSyncPauseUntil,
    setAutoSyncPauseUntil,
  } = useScraper()

  const postsInScopeCounts = useScopedPostCounts()
  const postsInScopeTotal = Object.values(postsInScopeCounts).reduce(
    (sum, n) => sum + n,
    0,
  )

  const { setChatMessages } = useChatContext()

  const { setSummary } = useAI()

  const loadMoreRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  const { theme, setTheme, proxyEnabled, torEnabled } = useSettings()

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

  /**
   * Set when a saved report replaces the working scope, so the change can be
   * stated instead of just happening. Cleared on dismiss, and replaced whenever
   * another report is opened.
   */
  const [restoredScope, setRestoredScope] = useState<RestoredScope | null>(null)

  const handleSelectHistorySummary = (s: SummaryListItem) => {
    setRestoredScope({
      channelCount: s.channels?.length ?? 0,
      startDate: s.startDate,
      endDate: s.endDate,
    })
    void applyHistorySummarySelection(s, {
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
      loadDetail: getSummary,
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

  /**
   * Each tab starts at the top.
   *
   * The workspace shares one scroll container across every tab, so the offset
   * survived a switch: scrolling deep into Posts and moving to Summary landed
   * you partway down a shorter view — sometimes past its end, on an apparently
   * blank screen. Keyed on `activeTab` so it fires on `?tab=` changes however
   * they happen: the nav links, the command palette, a pasted URL, or opening a
   * history record.
   *
   * `useLayoutEffect`, not `useEffect`: an effect runs *after* paint, so the new
   * tab rendered at the old offset and then jumped. Besides the visible flicker
   * that made the e2e suite flaky — content shifting under assertions that had
   * already begun — two runs failed on two different tests while the same suite
   * was green on `main`. A layout effect puts the container at the top before
   * the first paint of the new tab, so nothing moves afterwards.
   */
  useLayoutEffect(() => {
    const container = scrollContainerRef.current
    // Guarded so this is a genuine no-op when already at the top. An
    // unconditional write still forces a layout read/write on every tab render,
    // which cascades through the virtualized channel grid — that alone made the
    // e2e suite flaky on tabs that were never scrolled in the first place.
    if (container && container.scrollTop !== 0) container.scrollTop = 0
  }, [activeTab])

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

        {/*
         * Restored-scope banner (C8).
         *
         * Opening a saved report replaces the channel selection and the date
         * range — correctly, since a report only means anything beside the
         * posts it came from. But it used to happen in silence, so the "Posts
         * in Scope" counter and every scoped view changed underneath the user
         * with no explanation. This states the change; it does not undo it.
         */}
        <AnimatePresence>
          {restoredScope && (
            <motion.div
              initial={{ height: 0, opacity: 0, marginBottom: 0 }}
              animate={{ height: "auto", opacity: 1, marginBottom: 16 }}
              exit={{ height: 0, opacity: 0, marginBottom: 0 }}
              data-testid="restored-scope-banner"
              className="bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-400 px-4 py-3 flex items-center justify-between gap-3 text-xs rounded-md overflow-hidden"
            >
              <div className="flex items-center gap-3">
                <History className="w-4 h-4 shrink-0" />
                <span>
                  <strong className="uppercase tracking-wider">
                    Loaded from history.
                  </strong>{" "}
                  {isEmptyScope(restoredScope)
                    ? "This report was saved without any channels, so the selection is now empty."
                    : restoredScopeNotice(restoredScope)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setRestoredScope(null)}
                aria-label="Dismiss scope notice"
                className="shrink-0 uppercase tracking-widest font-bold opacity-60 hover:opacity-100 focus-visible:opacity-100 transition-opacity"
              >
                Dismiss
              </button>
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
                Technical Scraper & AI Analyst v{APP_VERSION}
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
                    aria-label="Command palette"
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
                    aria-label="Replay guided tour"
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
                    aria-label="Keyboard shortcuts"
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
                    aria-label={themeTooltip}
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
              {/*
               * Grouped because four of these are not global.
               *
               * `Enter`, `{cmd}+Enter`, `Esc` and `Backspace` are handled by the
               * command palette and do nothing anywhere else, but the flat list
               * presented all six alike — so "Run Highlighted Command / Enter"
               * read as an app-wide binding that silently did nothing.
               *
               * Only two shortcuts are genuinely global: the palette
               * (`useCommandPalette`) and this dialog (`App`). The list is
               * short because the app is, not because the list is incomplete.
               */}
              <div className="space-y-4 p-4 text-xs font-mono uppercase tracking-widest">
                {[
                  {
                    heading: "Anywhere",
                    bindings: [
                      {
                        label: "Command Palette",
                        keys: `${commandKey}+Shift+P`,
                      },
                      { label: "Keyboard Shortcuts", keys: "?" },
                    ],
                  },
                  {
                    heading: "In the command palette",
                    bindings: [
                      { label: "Run Highlighted Command", keys: "Enter" },
                      {
                        label: "Alternate Run Command",
                        keys: `${commandKey}+Enter`,
                      },
                      { label: "Back / Close Sub-View", keys: "Esc" },
                      { label: "Parent Sub-View", keys: "Backspace (empty)" },
                    ],
                  },
                ].map((group) => (
                  <section key={group.heading} className="space-y-2">
                    <h3 className="text-[10px] text-app-ink/50">
                      {group.heading}
                    </h3>
                    {group.bindings.map((binding) => (
                      <div
                        key={binding.label}
                        className="flex items-center justify-between rounded-md border border-app-ink/10 bg-app-muted/30 px-3 py-2"
                      >
                        <span>{binding.label}</span>
                        <code>{binding.keys}</code>
                      </div>
                    ))}
                  </section>
                ))}
              </div>
            </DialogContent>
          </Dialog>

          <div className="border border-app-ink border-opacity-20 flex min-h-0 flex-1 flex-col bg-app-card overflow-hidden">
            <div className="border-b border-app-ink border-opacity-10 p-4 flex flex-col gap-4 bg-app-muted shrink-0">
              <div className="flex justify-between items-center">
                {/*
                 * Real links, not buttons with click handlers.
                 *
                 * These are URL-addressable views — `setActiveTab` already did
                 * nothing but navigate to `?tab=` — so as `<button onClick>`
                 * they were unreachable by the things links give you free:
                 * middle-click, open-in-new-tab, "copy link address", and an
                 * announced destination.
                 *
                 * `aria-current="page"` rather than `role="tab"`: the ARIA tab
                 * pattern obliges a roving tabindex and arrow-key navigation,
                 * and claiming the role without implementing those leaves
                 * assistive-tech users worse off than plain links, because the
                 * keys they are told to use would do nothing. A `<nav>` of
                 * links marking the current one is honest about what this is.
                 *
                 * `replace` preserves the previous behaviour — tab switches
                 * did not stack history entries, and still do not.
                 */}
                <nav aria-label="Workspace sections" className="flex gap-4">
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
                        Compass,
                      }[tab.icon] || Database

                    const isActive = activeTab === tab.id

                    return (
                      <Link
                        key={tab.id}
                        id={`tour-tab-${tab.id}`}
                        to="/summarizer"
                        search={(prev) => ({ ...prev, tab: tab.id as TabType })}
                        replace
                        aria-current={isActive ? "page" : undefined}
                        className={`text-xs font-mono uppercase tracking-widest flex items-center gap-2 pb-1 border-b-2 transition-all ${
                          isActive
                            ? "border-app-ink opacity-100"
                            : "border-transparent opacity-40"
                        }`}
                      >
                        <Icon size={14} /> {tab.label}
                      </Link>
                    )
                  })}
                </nav>
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
                        {postsInScopeTotal.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* `data-tab` is derived from the `?tab=` param, so it always
                reports the tab the URL resolved to — including when an unknown
                value falls through to the PostFeed default below. */}
            <div
              ref={scrollContainerRef}
              data-testid="workspace-scroll"
              data-tab={activeTab}
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
                ) : activeTab === "discover" ? (
                  <DiscoverView />
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
