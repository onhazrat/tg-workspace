import {
  Activity,
  CheckCircle2,
  Cpu,
  Database,
  Globe,
  Info,
  Languages,
  Layout,
  Monitor,
  Moon,
  RefreshCw,
  RotateCw,
  Shield,
  Sun,
  Thermometer,
  XCircle,
  Zap,
} from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import type React from "react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "@/api"
import {
  AUTO_SYNC_INTERVAL_MAX_MINUTES,
  AUTO_SYNC_INTERVAL_MIN_MINUTES,
  DYNAMIC_SYNC_EXPECTED_POSTS_DEFAULT,
  LANGUAGES,
  MODELS,
} from "../constants"
import { useData } from "../contexts/DataContext"
import { useSettings } from "../contexts/SettingsContext"
import { JOB_LABELS, useJobToggles } from "../hooks/useJobToggles"
import { saveNetworkLog } from "../lib/repository"
import type { NetworkLog } from "../types"

export const SettingsView: React.FC<{ activeSection?: string }> = ({
  activeSection = "preferences",
}) => {
  const {
    theme,
    setTheme,
    aiLanguage,
    setAiLanguage,
    selectedModel,
    setSelectedModel,
    regularSyncIntervalMinutes,
    setRegularSyncIntervalMinutes,
    dynamicSyncEnabledDefault,
    setDynamicSyncEnabledDefault,
    dynamicSyncExpectedPostsDefault,
    setDynamicSyncExpectedPostsDefault,
    aiTemperature,
    setAiTemperature,
    proxyEnabled,
    setProxyEnabled,
    defaultProxyUrls,
    setDefaultProxyUrls,
    proxyDefaultConcurrency,
    setProxyDefaultConcurrency,
    proxyConcurrencyOverrides,
    setProxyConcurrencyOverrides,
    envFallbackConfigured,
    torAvailable,
    torEnabled,
    setTorEnabled,
    torMode,
    setTorMode,
    torProxyUrls,
    setTorProxyUrls,
    torRotationStrategy,
    setTorRotationStrategy,
    torControlEnabled,
    setTorControlEnabled,
    torControlPort,
    setTorControlPort,
    torAutoRotate,
    setTorAutoRotate,
    torRotationThreshold,
    setTorRotationThreshold,
    syncConcurrency,
    setSyncConcurrency,
    embeddingsEnabled,
    setEmbeddingsEnabled,
    embeddingsPaused,
    setEmbeddingsPaused,
    translationEnabled,
    setTranslationEnabled,
    autoTranslate,
    setAutoTranslate,
    translationModel,
    setTranslationModel,
    translationTargetLanguage,
    setTranslationTargetLanguage,
    postRetentionDays,
    globalStartTimeMode,
    setGlobalStartTimeMode,
    globalStartTimeValue,
    setGlobalStartTimeValue,
    getEffectiveGlobalStartTime,
    showChannelBio,
    setShowChannelBio,
    showChannelSubscribers,
    setShowChannelSubscribers,
    showChannelPhotos,
    setShowChannelPhotos,
    showChannelVideos,
    setShowChannelVideos,
    showChannelFiles,
    setShowChannelFiles,
    showChannelLinks,
    setShowChannelLinks,
    showChannelStartId,
    setShowChannelStartId,
    advancedMode,
    setAdvancedMode,
  } = useSettings()
  const { loadChannels, loadNetworkLogs } = useData()

  const [bulkReresolveConfirm, setBulkReresolveConfirm] = useState(false)
  const [bulkReresolveLoading, setBulkReresolveLoading] = useState(false)
  const [syncTemplateBusy, setSyncTemplateBusy] = useState(false)
  const [torStatus, setTorStatus] = useState<{
    running: boolean
    socksInUse: boolean
    controlInUse: boolean
    autoSpawned: boolean
  } | null>(null)
  const [torIp, setTorIp] = useState<string | null>(null)
  const [isCheckingIp, setIsCheckingIp] = useState(false)
  const [isChangingIp, setIsChangingIp] = useState(false)
  const [proxyTestResults, setProxyTestResults] = useState<
    Record<
      string,
      {
        success?: boolean
        ip?: string
        latency?: number
        error?: string
        testing?: boolean
      }
    >
  >({})
  const [isTestingAll, setIsTestingAll] = useState(false)
  const [badProxies, setBadProxies] = useState<
    { url: string; cooldownRemaining: number }[]
  >([])

  const applySyncTemplateToChannels = async (
    patch: {
      regularSyncEnabled?: boolean
      dynamicSyncEnabled?: boolean
      autoSyncIntervalMinutes?: number
      dynamicSyncExpectedPosts?: number
    },
    toastMessage: string,
  ) => {
    setSyncTemplateBusy(true)
    try {
      await api.bulkSyncSettings({ channelIds: null, ...patch })
      await loadChannels()
      toast.success(toastMessage)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to apply sync settings",
      )
    } finally {
      setSyncTemplateBusy(false)
    }
  }

  const proxyLines = defaultProxyUrls
    .split(/[\n,]+/)
    .map((p) => p.trim())
    .filter(Boolean)

  const normalizeProxyUrl = (proxyUrl: string): string => {
    let url = proxyUrl.trim()
    if (!url.includes("://")) {
      if (url.includes("127.0.0.1") || url.includes("localhost")) {
        url = `socks5h://${url}`
      } else {
        url = `http://${url}`
      }
    }
    if (url.startsWith("socks5://")) {
      url = url.replace("socks5://", "socks5h://")
    }
    return url
  }

  const slotsForProxy = (url: string): number => {
    const norm = normalizeProxyUrl(url)
    return proxyConcurrencyOverrides[norm] ?? proxyDefaultConcurrency
  }

  const effectiveProxyCapacity = proxyLines.reduce(
    (sum, url) => sum + slotsForProxy(url),
    0,
  )
  const { jobStatus, refreshJobStatus, toggleJob } = useJobToggles()
  const [triggeringJob, setTriggeringJob] = useState<string | null>(null)

  useEffect(() => {
    if (activeSection !== "sync") return
    refreshJobStatus()
    const timer = setInterval(refreshJobStatus, 15_000)
    return () => clearInterval(timer)
  }, [activeSection, refreshJobStatus])

  const handleTriggerJob = async (jobId: string) => {
    setTriggeringJob(jobId)
    try {
      await api.triggerJob(jobId)
      toast.success(`Triggered ${JOB_LABELS[jobId] || jobId}`)
      await refreshJobStatus()
    } catch (_error) {
      toast.error(`Failed to trigger ${JOB_LABELS[jobId] || jobId}`)
    } finally {
      setTriggeringJob(null)
    }
  }

  const handleToggleJob = async (jobId: string, enabled: boolean) => {
    await toggleJob(jobId, enabled)
  }

  const fetchProxyHealth = async () => {
    try {
      const data = await api.proxyHealth()
      setBadProxies(
        data.badProxies as { url: string; cooldownRemaining: number }[],
      )
    } catch (error) {
      console.error("Failed to fetch proxy health:", error)
    }
  }

  useEffect(() => {
    fetchProxyHealth()
    const interval = setInterval(fetchProxyHealth, 10000)
    return () => clearInterval(interval)
  }, [fetchProxyHealth])

  const testProxy = async (proxyUrl: string) => {
    setProxyTestResults((prev) => ({ ...prev, [proxyUrl]: { testing: true } }))
    const startTime = Date.now()
    let status: "success" | "failed" = "failed"
    let errorMsg: string | undefined
    let telemetryData: any = null

    try {
      const data = (await api.testProxy(proxyUrl)) as {
        success?: boolean
        error?: string
      }
      setProxyTestResults((prev) => ({ ...prev, [proxyUrl]: data }))

      if (data.success) {
        status = "success"
      } else {
        errorMsg = data.error || "Proxy test failed"
      }
      telemetryData = data
    } catch (error: any) {
      errorMsg = error.message
      setProxyTestResults((prev) => ({
        ...prev,
        [proxyUrl]: { success: false, error: error.message },
      }))
    } finally {
      const logEntry: NetworkLog = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        url: "/api/v1/network/test-proxy",
        method: "POST",
        status,
        duration: Date.now() - startTime,
        error: errorMsg,
        proxyUsed: proxyUrl,
        telemetry: telemetryData,
        source: "SettingsView.testProxy",
      }
      await saveNetworkLog(logEntry)
      loadNetworkLogs()
    }
  }

  const handleTestAllProxies = async (urls: string) => {
    const list = urls
      .split(/[\n,]+/)
      .map((p) => p.trim())
      .filter((p) => p)
    if (list.length === 0) {
      toast.error("No proxies to test")
      return
    }
    setIsTestingAll(true)
    for (const url of list) {
      await testProxy(url)
    }
    setIsTestingAll(false)
    toast.success("Proxy testing complete")
  }

  const clearProxyResults = () => setProxyTestResults({})

  const changeTorIp = async () => {
    setIsChangingIp(true)
    const startTime = Date.now()
    let status: "success" | "failed" = "failed"
    let errorMsg: string | undefined
    const telemetryData: any = null

    try {
      await api.torNewIdentity(torControlPort)
      status = "success"
      toast.success("New identity requested. IP will change shortly.")
      setTimeout(checkTorIp, 3000)
    } catch (error: any) {
      console.error("Failed to change TOR IP:", error)
      errorMsg = error.message || "Network error while requesting new identity"
      toast.error("Network error while requesting new identity")
    } finally {
      setIsChangingIp(false)
      const logEntry: NetworkLog = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        url: "/api/v1/network/tor-new-identity",
        method: "POST",
        status,
        duration: Date.now() - startTime,
        error: errorMsg,
        proxyUsed: "socks5h://127.0.0.1:9050",
        telemetry: telemetryData,
        source: "SettingsView.changeTorIp",
      }
      await saveNetworkLog(logEntry)
      loadNetworkLogs()
    }
  }

  const checkTorIp = async () => {
    setIsCheckingIp(true)
    const startTime = Date.now()
    let status: "success" | "failed" = "failed"
    let errorMsg: string | undefined
    let telemetryData: any = null

    try {
      const data = await api.torIp()
      setTorIp(data.ip)
      status = "success"
      telemetryData = data
      toast.success(`Current TOR IP: ${data.ip}`)
    } catch (error: any) {
      console.error("Failed to check TOR IP:", error)
      errorMsg = error.message || "Network error while checking TOR IP"
      toast.error("Network error while checking TOR IP")
    } finally {
      setIsCheckingIp(false)
      const logEntry: NetworkLog = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        url: "/api/v1/network/tor-ip",
        method: "GET",
        status,
        duration: Date.now() - startTime,
        error: errorMsg,
        proxyUsed: "socks5h://127.0.0.1:9050",
        telemetry: telemetryData,
        source: "SettingsView.checkTorIp",
      }
      await saveNetworkLog(logEntry)
      loadNetworkLogs()
    }
  }

  const restartTor = async () => {
    try {
      await api.torRestart()
      toast.success("TOR restart initiated")
    } catch (_e) {
      toast.error("Network error while restarting TOR")
    }
  }

  useEffect(() => {
    const checkTorStatus = async () => {
      try {
        const data = await api.torStatus()
        setTorStatus({ ...data, autoSpawned: false })
      } catch (error) {
        console.error("Failed to check TOR status:", error)
      }
    }

    checkTorStatus()
    const interval = setInterval(checkTorStatus, 10000)
    return () => clearInterval(interval)
  }, [])

  return (
    <motion.div
      key="settings"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8 pb-20"
    >
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex justify-between items-end">
          <div className="text-left">
            <div className="flex items-baseline gap-3">
              <h3 className="text-sm uppercase font-bold tracking-widest">
                {activeSection === "appearance"
                  ? "System Configuration"
                  : activeSection === "sync"
                    ? "Scraping & Synchronization"
                    : activeSection === "ai"
                      ? "AI & Models"
                      : "Network Configuration"}
              </h3>
              <span className="text-[10px] font-mono opacity-40">
                [{activeSection.toUpperCase()}]
              </span>
            </div>
            <p className="text-[10px] italic serif opacity-50 mt-1">
              {activeSection === "appearance"
                ? "Adjust appearance and interface settings."
                : activeSection === "sync"
                  ? "Configure automation, schedules, and data sync."
                  : activeSection === "ai"
                    ? "Configure LLMs, embeddings, and generation parameters."
                    : "Manage proxies, TOR, and synchronization networks."}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-tight opacity-60">
              Advanced Mode
            </span>
            <button
              type="button"
              onClick={() => setAdvancedMode(!advancedMode)}
              className={`w-10 h-5 transition-all relative border border-app-ink/20 ${advancedMode ? "bg-app-ink" : "bg-app-ink/10"}`}
            >
              <div
                className={`absolute top-0.5 w-3.5 h-3.5 transition-all ${advancedMode ? "left-5.5 bg-app-bg" : "left-0.5 bg-app-ink/50"}`}
              />
            </button>
          </div>
        </div>
        <div className="h-px bg-app-ink/10 w-full" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {activeSection === "appearance" && (
          <div className="space-y-8 lg:col-span-2">
            <div className="bg-app-card border border-app-ink/10 p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <Layout size={18} className="opacity-40" />
                <h4 className="text-[11px] uppercase font-bold tracking-widest">
                  Interface & Appearance
                </h4>
              </div>

              <div className="space-y-8">
                <div className="space-y-4">
                  <div className="flex items-center gap-2 opacity-60">
                    <Sun size={14} />
                    <span className="text-[10px] font-bold uppercase tracking-tight">
                      Color Theme
                    </span>
                  </div>
                  <div className="flex gap-2 p-1 bg-app-ink/5 border border-app-ink/10 w-fit">
                    <button
                      type="button"
                      onClick={() => setTheme("light")}
                      className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-2 ${
                        theme === "light"
                          ? "bg-app-ink text-app-bg"
                          : "opacity-40 hover:opacity-100"
                      }`}
                    >
                      <Sun size={12} /> Light
                    </button>
                    <button
                      type="button"
                      onClick={() => setTheme("dark")}
                      className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-2 ${
                        theme === "dark"
                          ? "bg-app-ink text-app-bg"
                          : "opacity-40 hover:opacity-100"
                      }`}
                    >
                      <Moon size={12} /> Dark
                    </button>
                    <button
                      type="button"
                      data-testid="system-mode"
                      onClick={() => setTheme("system")}
                      className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-2 ${
                        theme === "system"
                          ? "bg-app-ink text-app-bg"
                          : "opacity-40 hover:opacity-100"
                      }`}
                    >
                      <Monitor size={12} /> System
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* System Info */}
            <div className="bg-app-card border border-app-ink/10 p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <Info size={18} className="opacity-40" />
                <h4 className="text-[11px] uppercase font-bold tracking-widest">
                  System Information
                </h4>
              </div>

              <div className="space-y-6">
                <p className="text-[10px] leading-relaxed opacity-60 italic serif">
                  This dashboard is designed for high-speed monitoring and
                  analysis of Telegram channels. All data is stored locally in
                  your browser's IndexedDB. AI processing is powered by Google
                  Gemini. No data is sent to external servers except for
                  Telegram scraping and AI analysis.
                </p>

                <div className="space-y-3 pt-4 border-t border-app-ink/5">
                  <div className="flex justify-between text-[9px] font-mono uppercase tracking-widest">
                    <span className="opacity-40">Core Version</span>
                    <span>2.5.0-stable</span>
                  </div>
                  <div className="flex justify-between text-[9px] font-mono uppercase tracking-widest">
                    <span className="opacity-40">Storage Engine</span>
                    <span>IndexedDB (idb)</span>
                  </div>
                  <div className="flex justify-between text-[9px] font-mono uppercase tracking-widest">
                    <span className="opacity-40">AI Provider</span>
                    <span>Google Gemini API</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-app-card border border-app-ink/10 p-6 shadow-sm mt-8">
              <div className="flex items-center gap-3 mb-6">
                <Layout size={18} className="opacity-40" />
                <h4 className="text-[11px] uppercase font-bold tracking-widest">
                  Channel Card Display
                </h4>
              </div>

              <div className="space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 opacity-60">
                      <span className="text-[10px] font-bold uppercase tracking-tight">
                        Show Bio
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowChannelBio(!showChannelBio)}
                      className={`w-10 h-5 transition-all relative border border-app-ink/20 ${showChannelBio ? "bg-green-500 border-green-600" : "bg-app-ink/10"}`}
                    >
                      <div
                        className={`absolute top-0.5 w-3.5 h-3.5 bg-white transition-all ${showChannelBio ? "left-5.5" : "left-0.5"}`}
                      />
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 opacity-60">
                      <span className="text-[10px] font-bold uppercase tracking-tight">
                        Show Subscribers
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setShowChannelSubscribers(!showChannelSubscribers)
                      }
                      className={`w-10 h-5 transition-all relative border border-app-ink/20 ${showChannelSubscribers ? "bg-green-500 border-green-600" : "bg-app-ink/10"}`}
                    >
                      <div
                        className={`absolute top-0.5 w-3.5 h-3.5 bg-white transition-all ${showChannelSubscribers ? "left-5.5" : "left-0.5"}`}
                      />
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 opacity-60">
                      <span className="text-[10px] font-bold uppercase tracking-tight">
                        Show Photos Count
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowChannelPhotos(!showChannelPhotos)}
                      className={`w-10 h-5 transition-all relative border border-app-ink/20 ${showChannelPhotos ? "bg-green-500 border-green-600" : "bg-app-ink/10"}`}
                    >
                      <div
                        className={`absolute top-0.5 w-3.5 h-3.5 bg-white transition-all ${showChannelPhotos ? "left-5.5" : "left-0.5"}`}
                      />
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 opacity-60">
                      <span className="text-[10px] font-bold uppercase tracking-tight">
                        Show Videos Count
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowChannelVideos(!showChannelVideos)}
                      className={`w-10 h-5 transition-all relative border border-app-ink/20 ${showChannelVideos ? "bg-green-500 border-green-600" : "bg-app-ink/10"}`}
                    >
                      <div
                        className={`absolute top-0.5 w-3.5 h-3.5 bg-white transition-all ${showChannelVideos ? "left-5.5" : "left-0.5"}`}
                      />
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 opacity-60">
                      <span className="text-[10px] font-bold uppercase tracking-tight">
                        Show Files Count
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowChannelFiles(!showChannelFiles)}
                      className={`w-10 h-5 transition-all relative border border-app-ink/20 ${showChannelFiles ? "bg-green-500 border-green-600" : "bg-app-ink/10"}`}
                    >
                      <div
                        className={`absolute top-0.5 w-3.5 h-3.5 bg-white transition-all ${showChannelFiles ? "left-5.5" : "left-0.5"}`}
                      />
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 opacity-60">
                      <span className="text-[10px] font-bold uppercase tracking-tight">
                        Show Links Count
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowChannelLinks(!showChannelLinks)}
                      className={`w-10 h-5 transition-all relative border border-app-ink/20 ${showChannelLinks ? "bg-green-500 border-green-600" : "bg-app-ink/10"}`}
                    >
                      <div
                        className={`absolute top-0.5 w-3.5 h-3.5 bg-white transition-all ${showChannelLinks ? "left-5.5" : "left-0.5"}`}
                      />
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 opacity-60">
                      <span className="text-[10px] font-bold uppercase tracking-tight">
                        Show Start ID (Advanced)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowChannelStartId(!showChannelStartId)}
                      className={`w-10 h-5 transition-all relative border border-app-ink/20 ${showChannelStartId ? "bg-green-500 border-green-600" : "bg-app-ink/10"}`}
                    >
                      <div
                        className={`absolute top-0.5 w-3.5 h-3.5 bg-white transition-all ${showChannelStartId ? "left-5.5" : "left-0.5"}`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSection === "sync" && (
          <div className="space-y-8 lg:col-span-2">
            {/* Automation & Sync */}
            <div className="bg-app-card border border-app-ink/10 p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <RefreshCw size={18} className="opacity-40" />
                <h4 className="text-[11px] uppercase font-bold tracking-widest">
                  Automation & Sync
                </h4>
              </div>

              <div className="space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 opacity-60">
                      <RefreshCw size={14} />
                      <span className="text-[10px] font-bold uppercase tracking-tight">
                        New Channel Sync Defaults
                      </span>
                    </div>
                  </div>
                  <p className="text-[10px] opacity-40 italic serif">
                    These values seed newly added channels only.
                  </p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <label className="space-y-1.5">
                      <span className="text-[9px] uppercase font-bold tracking-widest text-app-ink/60">
                        Regular Interval (min)
                      </span>
                      <input
                        type="number"
                        min={AUTO_SYNC_INTERVAL_MIN_MINUTES}
                        max={AUTO_SYNC_INTERVAL_MAX_MINUTES}
                        step={1}
                        value={regularSyncIntervalMinutes}
                        onChange={(e) => {
                          const val = Number.parseInt(e.target.value, 10)
                          if (!Number.isNaN(val)) {
                            setRegularSyncIntervalMinutes(
                              Math.min(
                                AUTO_SYNC_INTERVAL_MAX_MINUTES,
                                Math.max(AUTO_SYNC_INTERVAL_MIN_MINUTES, val),
                              ),
                            )
                          }
                        }}
                        className="w-full bg-app-ink/5 border border-app-ink/10 p-2 text-[10px] font-mono focus:outline-none focus:border-app-ink/30 transition-all rounded"
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[9px] uppercase font-bold tracking-widest text-app-ink/60">
                        Dynamic Expected Posts
                      </span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={dynamicSyncExpectedPostsDefault}
                        onChange={(e) => {
                          const val = Number.parseInt(e.target.value, 10)
                          if (!Number.isNaN(val)) {
                            setDynamicSyncExpectedPostsDefault(
                              Math.max(1, Math.min(500, val)),
                            )
                          }
                        }}
                        className="w-full bg-app-ink/5 border border-app-ink/10 p-2 text-[10px] font-mono focus:outline-none focus:border-app-ink/30 transition-all rounded"
                      />
                    </label>
                    <div className="space-y-1.5">
                      <span className="text-[9px] uppercase font-bold tracking-widest text-app-ink/60">
                        Dynamic Enabled by Default
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setDynamicSyncEnabledDefault(!dynamicSyncEnabledDefault)
                        }
                        className={`w-10 h-5 transition-all relative border border-app-ink/20 rounded-full ${
                          dynamicSyncEnabledDefault
                            ? "bg-blue-500 border-blue-600"
                            : "bg-app-ink/10"
                        }`}
                      >
                        <div
                          className={`absolute top-0.5 w-3.5 h-3.5 bg-white transition-all rounded-full ${
                            dynamicSyncEnabledDefault ? "left-5.5" : "left-0.5"
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 pt-4 border-t border-app-ink/5">
                  <div className="flex items-center gap-2 opacity-60 mb-2">
                    <Zap size={14} />
                    <span className="text-[10px] font-bold uppercase tracking-tight">
                      Sync Concurrency
                    </span>
                  </div>
                  <p className="text-[10px] opacity-40 italic serif mb-2">
                    Number of channels to sync in parallel. Higher is faster but
                    riskier.
                  </p>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min="1"
                      value={syncConcurrency}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10)
                        setSyncConcurrency(
                          !Number.isNaN(val) && val >= 1 ? val : 1,
                        )
                      }}
                      className="w-20 bg-app-ink/5 border border-app-ink/10 p-2 text-[10px] font-mono focus:outline-none focus:border-app-ink/30 transition-all rounded"
                    />
                    <span className="text-[10px] opacity-60 uppercase tracking-widest font-bold">
                      Parallel channels
                    </span>
                  </div>
                  {syncConcurrency > 50 && (
                    <p className="text-[8px] text-amber-600/80 italic serif">
                      Values above 50 may trigger rate limits or bans. Use with
                      caution.
                    </p>
                  )}
                </div>

                <div className="space-y-4 pt-4 border-t border-app-ink/5">
                  <div className="flex items-center gap-2 opacity-60 mb-2">
                    <Database size={14} />
                    <span className="text-[10px] font-bold uppercase tracking-tight">
                      Default Channel Start Time
                    </span>
                  </div>
                  <p className="text-[10px] opacity-40 italic serif mb-4">
                    When adding a new channel, start scraping from this time.
                  </p>

                  <div className="flex bg-app-ink/5 p-1 rounded-lg border border-app-ink/10">
                    <button
                      type="button"
                      onClick={() => setGlobalStartTimeMode("retention")}
                      className={`flex-1 py-1.5 text-[9px] uppercase font-bold tracking-widest transition-all rounded-md ${
                        globalStartTimeMode === "retention"
                          ? "bg-app-ink text-app-bg shadow-sm"
                          : "text-app-ink/40 hover:text-app-ink/60"
                      }`}
                    >
                      Match Retention
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setGlobalStartTimeMode("relative")
                        if (typeof globalStartTimeValue !== "number") {
                          setGlobalStartTimeValue(1)
                        }
                      }}
                      className={`flex-1 py-1.5 text-[9px] uppercase font-bold tracking-widest transition-all rounded-md ${
                        globalStartTimeMode === "relative"
                          ? "bg-app-ink text-app-bg shadow-sm"
                          : "text-app-ink/40 hover:text-app-ink/60"
                      }`}
                    >
                      Relative
                    </button>
                    <button
                      type="button"
                      onClick={() => setGlobalStartTimeMode("absolute")}
                      className={`flex-1 py-1.5 text-[9px] uppercase font-bold tracking-widest transition-all rounded-md ${
                        globalStartTimeMode === "absolute"
                          ? "bg-app-ink text-app-bg shadow-sm"
                          : "text-app-ink/40 hover:text-app-ink/60"
                      }`}
                    >
                      Absolute
                    </button>
                  </div>

                  <AnimatePresence mode="wait">
                    {globalStartTimeMode === "relative" && (
                      <motion.div
                        key="relative"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="pt-2"
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="number"
                            min="1"
                            value={
                              typeof globalStartTimeValue === "number"
                                ? globalStartTimeValue
                                : 1
                            }
                            onChange={(e) =>
                              setGlobalStartTimeValue(
                                parseInt(e.target.value, 10) || 1,
                              )
                            }
                            className="w-20 bg-app-ink/5 border border-app-ink/10 p-2 text-[10px] font-mono focus:outline-none focus:border-app-ink/30 transition-all rounded"
                          />
                          <span className="text-[10px] opacity-60 uppercase tracking-widest font-bold">
                            Days Ago
                          </span>
                        </div>
                      </motion.div>
                    )}
                    {globalStartTimeMode === "absolute" && (
                      <motion.div
                        key="absolute"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="pt-2"
                      >
                        <input
                          type="datetime-local"
                          value={
                            typeof globalStartTimeValue === "string"
                              ? globalStartTimeValue.slice(0, 16)
                              : new Date().toISOString().slice(0, 16)
                          }
                          onChange={(e) => {
                            if (e.target.value) {
                              const date = new Date(e.target.value)
                              if (!Number.isNaN(date.getTime())) {
                                setGlobalStartTimeValue(date.toISOString())
                              }
                            }
                          }}
                          className="w-full bg-app-ink/5 border border-app-ink/10 p-2 text-[10px] font-mono focus:outline-none focus:border-app-ink/30 transition-all rounded"
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="mt-2 p-2 bg-app-ink/5 border border-app-ink/10 rounded flex items-center justify-between">
                    <span className="text-[9px] uppercase font-bold opacity-40">
                      Effective Start Date
                    </span>
                    <span className="text-[10px] font-mono font-bold tracking-wider">
                      {new Date(getEffectiveGlobalStartTime()).toLocaleString()}
                    </span>
                  </div>
                  {postRetentionDays > 0 && (
                    <p className="text-[8px] opacity-40 italic serif text-right">
                      Clamped by {postRetentionDays} days retention policy.
                    </p>
                  )}
                </div>

                <div className="space-y-3 pt-4 border-t border-app-ink/5">
                  <div className="flex items-center gap-2 opacity-60">
                    <RotateCw size={14} />
                    <span className="text-[10px] font-bold uppercase tracking-tight">
                      Bulk Re-sync
                    </span>
                  </div>
                  <p className="text-[10px] opacity-40 italic serif">
                    Clear stored posts and re-backfill all channels from the
                    latest page backward to the retention window.
                  </p>
                  {!bulkReresolveConfirm ? (
                    <button
                      type="button"
                      onClick={() => setBulkReresolveConfirm(true)}
                      disabled={bulkReresolveLoading}
                      className="px-4 py-2 text-[10px] uppercase font-bold tracking-widest border border-app-ink/20 bg-app-ink/5 hover:bg-app-ink/10 transition-all disabled:opacity-40"
                    >
                      Reset &amp; sync all channels
                    </button>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={bulkReresolveLoading}
                        onClick={async () => {
                          setBulkReresolveLoading(true)
                          try {
                            const result = await api.bulkResetSync({
                              confirm: true,
                            })
                            await loadChannels()
                            toast.success(
                              `Reset ${result.channelsReset} channel(s); deleted ${result.postsDeleted} post(s).` +
                                (result.errors.length
                                  ? ` ${result.errors.length} error(s).`
                                  : ""),
                            )
                          } catch (err) {
                            toast.error(
                              err instanceof Error
                                ? err.message
                                : "Bulk re-sync failed",
                            )
                          } finally {
                            setBulkReresolveLoading(false)
                            setBulkReresolveConfirm(false)
                          }
                        }}
                        className="px-4 py-2 text-[10px] uppercase font-bold tracking-widest border border-green-600/40 bg-green-500/10 hover:bg-green-500/20 transition-all disabled:opacity-40"
                      >
                        {bulkReresolveLoading
                          ? "Running…"
                          : "Confirm reset & sync"}
                      </button>
                      <button
                        type="button"
                        disabled={bulkReresolveLoading}
                        onClick={() => setBulkReresolveConfirm(false)}
                        className="px-3 py-2 text-[10px] uppercase font-bold tracking-widest opacity-50 hover:opacity-80"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                <div className="space-y-4 pt-4 border-t border-app-ink/5">
                  <div className="flex items-center gap-2 opacity-60">
                    <Zap size={14} />
                    <span className="text-[10px] font-bold uppercase tracking-tight">
                      Apply to Existing Channels
                    </span>
                  </div>
                  <p className="text-[10px] opacity-40 italic serif">
                    Use bulk PATCH to update all channel sync settings at once.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={syncTemplateBusy}
                      onClick={() =>
                        applySyncTemplateToChannels(
                          { regularSyncEnabled: false },
                          "Disabled regular sync on all channels",
                        )
                      }
                      className="px-3 py-1.5 text-[10px] uppercase font-bold rounded-md bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 transition-all disabled:opacity-40"
                    >
                      Disable Regular (All)
                    </button>
                    <button
                      type="button"
                      disabled={syncTemplateBusy}
                      onClick={() =>
                        applySyncTemplateToChannels(
                          { regularSyncEnabled: true },
                          "Enabled regular sync on all channels",
                        )
                      }
                      className="px-3 py-1.5 text-[10px] uppercase font-bold rounded-md bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 transition-all disabled:opacity-40"
                    >
                      Enable Regular (All)
                    </button>
                    <button
                      type="button"
                      disabled={syncTemplateBusy}
                      onClick={() =>
                        applySyncTemplateToChannels(
                          { dynamicSyncEnabled: true },
                          "Enabled dynamic sync on all channels",
                        )
                      }
                      className="px-3 py-1.5 text-[10px] uppercase font-bold rounded-md bg-blue-500/10 text-blue-700 hover:bg-blue-500/20 transition-all disabled:opacity-40"
                    >
                      Enable Dynamic (All)
                    </button>
                    <button
                      type="button"
                      disabled={syncTemplateBusy}
                      onClick={() =>
                        applySyncTemplateToChannels(
                          { dynamicSyncEnabled: false },
                          "Disabled dynamic sync on all channels",
                        )
                      }
                      className="px-3 py-1.5 text-[10px] uppercase font-bold rounded-md bg-app-muted/60 text-app-ink/70 hover:bg-app-ink/10 transition-all disabled:opacity-40"
                    >
                      Disable Dynamic (All)
                    </button>
                    <button
                      type="button"
                      disabled={syncTemplateBusy}
                      onClick={() =>
                        applySyncTemplateToChannels(
                          {
                            autoSyncIntervalMinutes: regularSyncIntervalMinutes,
                            dynamicSyncExpectedPosts:
                              dynamicSyncExpectedPostsDefault ||
                              DYNAMIC_SYNC_EXPECTED_POSTS_DEFAULT,
                          },
                          "Applied sync templates to all channels",
                        )
                      }
                      className="px-3 py-1.5 text-[10px] uppercase font-bold rounded-md bg-app-ink text-app-bg hover:opacity-90 transition-all disabled:opacity-40"
                    >
                      Apply Templates to All
                    </button>
                  </div>
                </div>

                <div className="space-y-4 pt-6 border-t border-app-ink/5">
                  <div className="flex items-center gap-2 opacity-60 mb-2">
                    <Activity size={14} />
                    <span className="text-[10px] font-bold uppercase tracking-tight">
                      Background Jobs (Server)
                    </span>
                  </div>
                  <p className="text-[10px] opacity-40 italic serif mb-4">
                    APScheduler runs these jobs even when the browser is closed.
                  </p>
                  <div className="space-y-2">
                    {Object.entries(JOB_LABELS).map(([jobId, label]) => {
                      const entry = jobStatus[jobId]
                      const statusColor =
                        entry?.lastStatus === "ok"
                          ? "text-green-600"
                          : entry?.lastStatus === "error"
                            ? "text-red-500"
                            : entry?.lastStatus === "running"
                              ? "text-amber-600"
                              : "text-app-ink/50"
                      return (
                        <div
                          key={jobId}
                          className="flex items-center justify-between gap-3 p-3 border border-app-ink/10 rounded-md bg-app-muted/30"
                        >
                          <div className="min-w-0">
                            <div className="text-[10px] font-bold uppercase tracking-tight">
                              {label}
                            </div>
                            <div
                              className={`text-[9px] font-mono uppercase ${statusColor}`}
                            >
                              {entry?.lastStatus || "—"}
                              {entry?.lastError
                                ? ` · ${entry.lastError.slice(0, 60)}`
                                : ""}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                handleToggleJob(
                                  jobId,
                                  !(entry?.enabled ?? true),
                                )
                              }
                              className={`w-8 h-4 transition-all relative border border-app-ink/20 rounded-sm ${
                                entry?.enabled !== false
                                  ? "bg-green-500 border-green-600"
                                  : "bg-app-ink/10"
                              }`}
                              title={
                                entry?.enabled !== false
                                  ? "Disable job"
                                  : "Enable job"
                              }
                            >
                              <div
                                className={`absolute top-0.5 w-2.5 h-2.5 bg-white transition-all rounded-sm ${
                                  entry?.enabled !== false
                                    ? "left-4"
                                    : "left-0.5"
                                }`}
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleTriggerJob(jobId)}
                              disabled={triggeringJob === jobId}
                              className="px-2 py-1 text-[9px] font-mono uppercase border border-app-ink/20 hover:bg-app-ink/5 disabled:opacity-50"
                            >
                              {triggeringJob === jobId ? "…" : "Run"}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSection === "network" && (
          <div className="space-y-8 lg:col-span-2">
            {/* Network & Proxy */}
            {advancedMode && (
              <>
                <div className="bg-app-card border border-app-ink/10 p-6 shadow-sm">
                  <div className="flex items-center gap-3 mb-6">
                    <Globe size={18} className="opacity-40" />
                    <h4 className="text-[11px] uppercase font-bold tracking-widest">
                      Network & Proxy
                    </h4>
                  </div>

                  <div className="space-y-6">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 opacity-60">
                          <Globe size={14} />
                          <span className="text-[10px] font-bold uppercase tracking-tight">
                            Enable Proxies
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setProxyEnabled(!proxyEnabled)}
                          className={`w-10 h-5 transition-all relative border border-app-ink/20 ${proxyEnabled ? "bg-green-500 border-green-600" : "bg-app-ink/10"}`}
                        >
                          <div
                            className={`absolute top-0.5 w-3.5 h-3.5 bg-white transition-all ${proxyEnabled ? "left-5.5" : "left-0.5"}`}
                          />
                        </button>
                      </div>
                      <p className="text-[10px] opacity-40 italic serif">
                        Rotate through proxy servers to avoid Telegram rate
                        limits.
                      </p>
                    </div>

                    <AnimatePresence>
                      {proxyEnabled && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="space-y-4 overflow-hidden"
                        >
                          <div className="flex items-center justify-between opacity-60">
                            <span className="text-[10px] font-bold uppercase tracking-tight">
                              Proxy List (HTTP/SOCKS5)
                            </span>
                            <div className="flex gap-3">
                              {Object.keys(proxyTestResults).length > 0 && (
                                <button
                                  type="button"
                                  onClick={clearProxyResults}
                                  className="text-[9px] uppercase font-bold tracking-widest hover:underline opacity-60"
                                >
                                  Clear
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  handleTestAllProxies(defaultProxyUrls)
                                }
                                disabled={isTestingAll}
                                className="text-[9px] uppercase font-bold tracking-widest hover:underline flex items-center gap-1 disabled:opacity-30"
                              >
                                {isTestingAll ? (
                                  <RotateCw
                                    size={10}
                                    className="animate-spin"
                                  />
                                ) : (
                                  <Activity size={10} />
                                )}
                                Test All
                              </button>
                            </div>
                          </div>
                          <textarea
                            value={defaultProxyUrls}
                            onChange={(e) =>
                              setDefaultProxyUrls(e.target.value)
                            }
                            placeholder="http://user:pass@host:port or socks5h://host:port (one per line)"
                            className="w-full h-32 bg-app-ink/5 border border-app-ink/10 p-3 text-[10px] font-mono focus:outline-none focus:border-app-ink/30 transition-all resize-none"
                          />

                          <div className="space-y-3 pt-2 border-t border-app-ink/5">
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-[10px] font-bold uppercase tracking-tight opacity-60">
                                Default slots per proxy
                              </span>
                              <input
                                type="number"
                                min={1}
                                max={20}
                                value={proxyDefaultConcurrency}
                                onChange={(e) =>
                                  setProxyDefaultConcurrency(
                                    Math.max(
                                      1,
                                      Math.min(
                                        20,
                                        parseInt(e.target.value, 10) || 1,
                                      ),
                                    ),
                                  )
                                }
                                className="w-16 bg-app-ink/5 border border-app-ink/10 p-2 text-[10px] font-mono text-right focus:outline-none focus:border-app-ink/30"
                              />
                            </div>
                            {proxyLines.length > 0 && (
                              <div className="space-y-2">
                                <span className="text-[10px] font-bold uppercase tracking-tight opacity-60">
                                  Per-proxy overrides
                                </span>
                                <div className="space-y-1">
                                  {proxyLines.map((url) => (
                                    <div
                                      key={url}
                                      className="flex items-center justify-between gap-3 text-[9px] bg-app-ink/5 p-2 border border-app-ink/5 rounded"
                                    >
                                      <span className="font-mono truncate flex-1 opacity-60">
                                        {url}
                                      </span>
                                      <input
                                        type="number"
                                        min={1}
                                        max={20}
                                        value={slotsForProxy(url)}
                                        onChange={(e) => {
                                          const slots = Math.max(
                                            1,
                                            Math.min(
                                              20,
                                              parseInt(e.target.value, 10) || 1,
                                            ),
                                          )
                                          const norm = normalizeProxyUrl(url)
                                          setProxyConcurrencyOverrides({
                                            ...proxyConcurrencyOverrides,
                                            [norm]: slots,
                                          })
                                        }}
                                        className="w-14 bg-white/50 border border-app-ink/10 p-1 text-[9px] font-mono text-right focus:outline-none"
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            <p className="text-[8px] opacity-40 italic serif">
                              Effective parallel HTTP capacity ≈{" "}
                              {effectiveProxyCapacity ||
                                proxyDefaultConcurrency}{" "}
                              slot
                              {(effectiveProxyCapacity ||
                                proxyDefaultConcurrency) === 1
                                ? ""
                                : "s"}
                              . Keep <strong>Sync concurrency</strong> (Scraping
                              &amp; Sync) at or below this when using proxies.
                            </p>
                          </div>

                          {/* Proxy Test Results */}
                          {Object.keys(proxyTestResults).length > 0 &&
                            defaultProxyUrls
                              .split(/[\n,]+/)
                              .some((p) => proxyTestResults[p.trim()]) && (
                              <div className="space-y-1 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                                {defaultProxyUrls
                                  .split(/[\n,]+/)
                                  .map((p) => p.trim())
                                  .filter((p) => p && proxyTestResults[p])
                                  .map((url, idx) => {
                                    const res = proxyTestResults[url]
                                    return (
                                      <div
                                        key={idx}
                                        className="flex items-center justify-between text-[9px] bg-app-ink/5 p-2 border border-app-ink/5 rounded"
                                      >
                                        <span className="font-mono truncate max-w-[150px] opacity-60">
                                          {url}
                                        </span>
                                        <div className="flex items-center gap-2">
                                          {res.testing ? (
                                            <span className="flex items-center gap-1 opacity-40">
                                              <RotateCw
                                                size={8}
                                                className="animate-spin"
                                              />{" "}
                                              Testing...
                                            </span>
                                          ) : res.success ? (
                                            <>
                                              <span className="text-green-600 font-bold flex items-center gap-1">
                                                <CheckCircle2 size={8} />{" "}
                                                {res.latency}ms
                                              </span>
                                              <span className="opacity-40 font-mono">
                                                ({res.ip})
                                              </span>
                                            </>
                                          ) : (
                                            <span
                                              className="text-red-600 font-bold flex items-center gap-1"
                                              title={res.error}
                                            >
                                              <XCircle size={8} /> Error
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    )
                                  })}
                              </div>
                            )}

                          {/* Blacklisted Proxies Dashboard */}
                          {badProxies.length > 0 && (
                            <div className="space-y-3 pt-2 border-t border-app-ink/5">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold uppercase tracking-tight text-red-600 flex items-center gap-2">
                                  <Shield size={10} /> Blacklisted Proxies
                                </span>
                                <span className="text-[8px] opacity-40 uppercase tracking-widest">
                                  Auto-Cooldown
                                </span>
                              </div>
                              <div className="space-y-1">
                                {badProxies.map((proxy, idx) => (
                                  <div
                                    key={idx}
                                    className="flex items-center justify-between text-[9px] bg-red-500/5 p-2 border border-red-500/10 rounded"
                                  >
                                    <span className="font-mono truncate max-w-[180px] opacity-60">
                                      {proxy.url}
                                    </span>
                                    <span className="text-red-600 font-bold tabular-nums">
                                      {Math.floor(proxy.cooldownRemaining / 60)}
                                      :
                                      {(proxy.cooldownRemaining % 60)
                                        .toString()
                                        .padStart(2, "0")}
                                    </span>
                                  </div>
                                ))}
                              </div>
                              <p className="text-[8px] opacity-30 italic serif">
                                Proxies are temporarily avoided after repeated
                                network failures.
                              </p>
                            </div>
                          )}

                          <p className="text-[10px] opacity-40 italic serif">
                            Your proxy list is saved to your account on the
                            server.
                            {envFallbackConfigured && (
                              <>
                                {" "}
                                When empty and proxies are enabled, the server
                                falls back to{" "}
                                <code className="font-mono">
                                  DEFAULT_PROXY_URLS
                                </code>{" "}
                                env.
                              </>
                            )}
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* TOR Network */}
                <div className="bg-app-card border border-app-ink/10 p-6 shadow-sm">
                  {!torAvailable && (
                    <p className="text-[10px] text-amber-700/80 italic serif mb-4">
                      Tor is disabled on this server. Set{" "}
                      <code className="font-mono">TOR_ENABLED=true</code> and
                      configure the Tor sidecar to enable.
                    </p>
                  )}
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <Shield size={18} className="opacity-40" />
                      <h4 className="text-[11px] uppercase font-bold tracking-widest">
                        TOR Network
                      </h4>
                    </div>
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-1.5 h-1.5 rounded-full ${torStatus?.running ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" : "bg-red-500"}`}
                      />
                      <span className="text-[9px] font-bold uppercase tracking-widest opacity-60">
                        {torStatus?.running ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 opacity-60">
                          <Shield size={14} />
                          <span className="text-[10px] font-bold uppercase tracking-tight">
                            Enable TOR Proxy
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setTorEnabled(!torEnabled)}
                          className={`w-10 h-5 transition-all relative border border-app-ink/20 ${torEnabled ? "bg-green-500 border-green-600" : "bg-app-ink/10"}`}
                        >
                          <div
                            className={`absolute top-0.5 w-3.5 h-3.5 bg-white transition-all ${torEnabled ? "left-5.5" : "left-0.5"}`}
                          />
                        </button>
                      </div>
                      <p className="text-[10px] opacity-40 italic serif">
                        Use TOR to anonymize requests and bypass geographic
                        restrictions.
                      </p>
                    </div>

                    <AnimatePresence>
                      {torEnabled && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="space-y-6 overflow-hidden pt-4"
                        >
                          {/* Status Dashboard */}
                          <div className="flex items-center justify-between bg-app-ink/5 p-4 rounded-xl border border-app-ink/10">
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-2 h-2 rounded-full ${torStatus?.running ? "bg-green-500 animate-pulse" : "bg-red-500"}`}
                              />
                              <span className="text-[10px] font-bold uppercase tracking-widest">
                                Network Status
                              </span>
                            </div>
                            <div className="flex gap-2">
                              {torStatus?.running ? (
                                <span className="px-2 py-0.5 bg-green-500/10 text-green-600 text-[8px] font-bold uppercase rounded border border-green-500/20 flex items-center gap-1">
                                  <CheckCircle2 size={8} /> Active
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 bg-red-500/10 text-red-600 text-[8px] font-bold uppercase rounded border border-red-500/20 flex items-center gap-1">
                                  <XCircle size={8} /> Offline
                                </span>
                              )}
                              {torStatus?.controlInUse && (
                                <span className="px-2 py-0.5 bg-blue-500/10 text-blue-600 text-[8px] font-bold uppercase rounded border border-blue-500/20 flex items-center gap-1">
                                  <Zap size={8} /> Control Connected
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Mode Selection */}
                          <div className="space-y-3">
                            <span className="text-[10px] font-bold uppercase tracking-tight opacity-60">
                              Connection Mode
                            </span>
                            <div className="flex bg-app-ink/5 p-1 rounded-lg border border-app-ink/10">
                              {(["auto", "custom"] as const).map((mode) => (
                                <button
                                  type="button"
                                  key={mode}
                                  onClick={() => setTorMode(mode)}
                                  className={`flex-1 py-1.5 text-[9px] uppercase font-bold tracking-widest transition-all rounded-md ${
                                    torMode === mode
                                      ? "bg-app-ink text-app-bg shadow-sm"
                                      : "text-app-ink/40 hover:text-app-ink/60"
                                  }`}
                                >
                                  {mode === "auto"
                                    ? "Automatic (Local)"
                                    : "Custom Cluster"}
                                </button>
                              ))}
                            </div>
                            <p className="text-[9px] opacity-40 italic serif">
                              {torMode === "auto"
                                ? "Uses the built-in TOR service on port 9050. Recommended for most users."
                                : "Connect to multiple external TOR instances for high-throughput rotation."}
                            </p>
                          </div>

                          {/* Proxy Pool (Only in Custom Mode) */}
                          <AnimatePresence>
                            {torMode === "custom" && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                className="space-y-3 overflow-hidden"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-bold uppercase tracking-tight opacity-60">
                                    SOCKS5 Proxy Pool
                                  </span>
                                  <div className="flex gap-3">
                                    {Object.keys(proxyTestResults).length >
                                      0 && (
                                      <button
                                        type="button"
                                        onClick={clearProxyResults}
                                        className="text-[9px] uppercase font-bold tracking-widest hover:underline opacity-40"
                                      >
                                        Clear
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleTestAllProxies(torProxyUrls)
                                      }
                                      disabled={isTestingAll}
                                      className="text-[9px] uppercase font-bold tracking-widest hover:underline flex items-center gap-1 disabled:opacity-30"
                                    >
                                      {isTestingAll ? (
                                        <RotateCw
                                          size={10}
                                          className="animate-spin"
                                        />
                                      ) : (
                                        <Activity size={10} />
                                      )}
                                      Test All
                                    </button>
                                  </div>
                                </div>
                                <textarea
                                  value={torProxyUrls}
                                  onChange={(e) =>
                                    setTorProxyUrls(e.target.value)
                                  }
                                  placeholder="127.0.0.1:9050"
                                  className="w-full h-24 bg-app-ink/5 border border-app-ink/10 p-4 text-[10px] font-mono focus:outline-none focus:border-app-ink/30 transition-all resize-none rounded-lg"
                                />

                                {/* TOR Proxy Test Results */}
                                {Object.keys(proxyTestResults).length > 0 &&
                                  torProxyUrls
                                    .split(/[\n,]+/)
                                    .some(
                                      (p) => proxyTestResults[p.trim()],
                                    ) && (
                                    <div className="space-y-1 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                                      {torProxyUrls
                                        .split(/[\n,]+/)
                                        .map((p) => p.trim())
                                        .filter((p) => p && proxyTestResults[p])
                                        .map((url, idx) => {
                                          const res = proxyTestResults[url]
                                          // For TOR pool, we might need to prepend socks5h:// if it's just IP:PORT
                                          const _displayUrl = url.includes(
                                            "://",
                                          )
                                            ? url
                                            : `socks5h://${url}`
                                          return (
                                            <div
                                              key={idx}
                                              className="flex items-center justify-between text-[9px] bg-app-ink/5 p-2 border border-app-ink/5 rounded"
                                            >
                                              <span className="font-mono truncate max-w-[150px] opacity-60">
                                                {url}
                                              </span>
                                              <div className="flex items-center gap-2">
                                                {res.testing ? (
                                                  <span className="flex items-center gap-1 opacity-40">
                                                    <RotateCw
                                                      size={8}
                                                      className="animate-spin"
                                                    />{" "}
                                                    Testing...
                                                  </span>
                                                ) : res.success ? (
                                                  <>
                                                    <span className="text-green-600 font-bold flex items-center gap-1">
                                                      <CheckCircle2 size={8} />{" "}
                                                      {res.latency}ms
                                                    </span>
                                                    <span className="opacity-40 font-mono">
                                                      ({res.ip})
                                                    </span>
                                                  </>
                                                ) : (
                                                  <span
                                                    className="text-red-600 font-bold flex items-center gap-1"
                                                    title={res.error}
                                                  >
                                                    <XCircle size={8} /> Error
                                                  </span>
                                                )}
                                              </div>
                                            </div>
                                          )
                                        })}
                                    </div>
                                  )}
                              </motion.div>
                            )}
                          </AnimatePresence>

                          {/* Strategy & Actions */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div className="space-y-3">
                              <span className="text-[10px] font-bold uppercase tracking-tight opacity-60">
                                Rotation Strategy
                              </span>
                              <div
                                className={`flex bg-app-ink/5 p-1 rounded-lg border border-app-ink/10 ${torMode === "auto" ? "opacity-30 grayscale pointer-events-none" : ""}`}
                              >
                                {(["sequential", "random"] as const).map(
                                  (strategy) => (
                                    <button
                                      type="button"
                                      key={strategy}
                                      disabled={torMode === "auto"}
                                      onClick={() =>
                                        setTorRotationStrategy(strategy)
                                      }
                                      className={`flex-1 py-1.5 text-[9px] uppercase font-bold tracking-widest transition-all rounded-md ${
                                        torRotationStrategy === strategy
                                          ? "bg-app-ink text-app-bg shadow-sm"
                                          : "text-app-ink/40 hover:text-app-ink/60"
                                      }`}
                                    >
                                      {strategy}
                                    </button>
                                  ),
                                )}
                              </div>
                            </div>

                            <div className="space-y-3">
                              <span className="text-[10px] font-bold uppercase tracking-tight opacity-60">
                                Quick Actions
                              </span>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={restartTor}
                                  className="flex-1 py-1.5 text-[9px] uppercase font-bold tracking-widest border border-app-ink/20 hover:bg-app-ink hover:text-app-bg transition-all rounded-lg flex items-center justify-center gap-2"
                                >
                                  <RefreshCw size={10} /> Restart
                                </button>
                                <button
                                  type="button"
                                  onClick={checkTorIp}
                                  disabled={isCheckingIp || !torStatus?.running}
                                  className="flex-1 py-1.5 text-[9px] uppercase font-bold tracking-widest border border-app-ink/20 hover:bg-app-ink hover:text-app-bg transition-all rounded-lg flex items-center justify-center gap-2 disabled:opacity-30"
                                >
                                  {isCheckingIp ? (
                                    <RefreshCw
                                      size={10}
                                      className="animate-spin"
                                    />
                                  ) : (
                                    <Globe size={10} />
                                  )}
                                  {isCheckingIp ? "..." : "Check IP"}
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* IP Display */}
                          <AnimatePresence>
                            {torIp && (
                              <motion.div
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="bg-app-ink/5 p-3 rounded-lg border border-app-ink/10 flex items-center justify-between"
                              >
                                <span className="text-[9px] uppercase font-bold opacity-40">
                                  Current Exit IP
                                </span>
                                <span className="text-[10px] font-mono font-bold tracking-wider">
                                  {torIp}
                                </span>
                              </motion.div>
                            )}
                          </AnimatePresence>

                          {/* Control Port Section */}
                          <div className="pt-4 border-t border-app-ink/5 space-y-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 opacity-60">
                                <Activity size={14} />
                                <div className="flex flex-col">
                                  <span className="text-[10px] font-bold uppercase tracking-tight">
                                    IP Rotation Control
                                  </span>
                                  <span className="text-[8px] opacity-40 italic serif">
                                    Requires ControlPort enabled in torrc
                                  </span>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setTorControlEnabled(!torControlEnabled)
                                }
                                className={`w-10 h-5 rounded-full transition-all relative ${torControlEnabled ? "bg-app-ink" : "bg-app-ink/10"}`}
                              >
                                <div
                                  className={`absolute top-1 w-3 h-3 rounded-full bg-app-bg transition-all ${torControlEnabled ? "left-6" : "left-1"}`}
                                />
                              </button>
                            </div>

                            <AnimatePresence>
                              {torControlEnabled && (
                                <motion.div
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: "auto" }}
                                  exit={{ opacity: 0, height: 0 }}
                                  className="space-y-4 overflow-hidden"
                                >
                                  <div className="grid grid-cols-1 gap-4">
                                    <div className="space-y-2">
                                      <span className="text-[10px] font-bold uppercase tracking-tight opacity-60">
                                        Control Port
                                      </span>
                                      <input
                                        type="number"
                                        value={torControlPort}
                                        onChange={(e) =>
                                          setTorControlPort(
                                            parseInt(e.target.value, 10),
                                          )
                                        }
                                        className="w-full bg-app-ink/5 border border-app-ink/10 p-3 text-[10px] font-mono focus:outline-none focus:border-app-ink/30 transition-all rounded-lg"
                                      />
                                    </div>
                                    <p className="text-[9px] opacity-50 italic serif">
                                      Tor control password is configured on the
                                      server via{" "}
                                      <code className="font-mono">
                                        TOR_CONTROL_PASSWORD
                                      </code>
                                      .
                                    </p>
                                  </div>
                                  <div className="flex items-center justify-between pt-2 bg-app-ink/5 p-3 rounded-lg border border-app-ink/10">
                                    <p className="text-[9px] opacity-60 italic serif max-w-[200px]">
                                      Request a fresh IP from TOR when rate
                                      limited.
                                    </p>
                                    <button
                                      type="button"
                                      onClick={changeTorIp}
                                      disabled={
                                        isChangingIp || !torStatus?.controlInUse
                                      }
                                      className={`px-4 py-2 text-[9px] uppercase font-bold tracking-widest border border-app-ink/20 transition-all flex items-center gap-2 rounded-lg ${
                                        isChangingIp || !torStatus?.controlInUse
                                          ? "opacity-30 cursor-not-allowed"
                                          : "bg-app-ink text-app-bg hover:opacity-90 shadow-sm"
                                      }`}
                                    >
                                      {isChangingIp ? (
                                        <RotateCw
                                          size={10}
                                          className="animate-spin"
                                        />
                                      ) : (
                                        <Shield size={10} />
                                      )}
                                      {isChangingIp
                                        ? "Rotating..."
                                        : "New Identity"}
                                    </button>
                                  </div>

                                  <div className="pt-4 border-t border-app-ink/5 space-y-4">
                                    <div className="flex items-center justify-between">
                                      <div className="flex flex-col">
                                        <span className="text-[10px] font-bold uppercase tracking-tight opacity-60">
                                          Auto-Rotate IP
                                        </span>
                                        <span className="text-[8px] opacity-40 italic serif">
                                          Rotate identity automatically after X
                                          requests.
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setTorAutoRotate(!torAutoRotate)
                                        }
                                        className={`w-10 h-5 rounded-full transition-all relative ${torAutoRotate ? "bg-app-ink" : "bg-app-ink/10"}`}
                                      >
                                        <div
                                          className={`absolute top-1 w-3 h-3 rounded-full bg-app-bg transition-all ${torAutoRotate ? "left-6" : "left-1"}`}
                                        />
                                      </button>
                                    </div>

                                    {torAutoRotate && (
                                      <motion.div
                                        initial={{ opacity: 0, y: -10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="flex items-center justify-between"
                                      >
                                        <div className="flex flex-col">
                                          <span className="text-[10px] font-bold uppercase tracking-tight opacity-60">
                                            Rotation Threshold
                                          </span>
                                          <span className="text-[8px] opacity-40 italic serif">
                                            Requests before rotation.
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                          <input
                                            type="number"
                                            min={5}
                                            max={50}
                                            step={1}
                                            value={torRotationThreshold}
                                            onChange={(e) => {
                                              const val = Number.parseInt(
                                                e.target.value,
                                                10,
                                              )
                                              if (!Number.isNaN(val)) {
                                                setTorRotationThreshold(
                                                  Math.min(
                                                    50,
                                                    Math.max(5, val),
                                                  ),
                                                )
                                              }
                                            }}
                                            className="w-16 bg-app-ink/5 border border-app-ink/10 p-2 text-[10px] font-mono text-right focus:outline-none focus:border-app-ink/30"
                                          />
                                        </div>
                                      </motion.div>
                                    )}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {activeSection === "ai" && (
          <div className="space-y-8 lg:col-span-2">
            {/* AI Configuration */}
            <div className="bg-app-card border border-app-ink/10 p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <Cpu size={18} className="opacity-40" />
                <h4 className="text-[11px] uppercase font-bold tracking-widest">
                  AI Engine Parameters
                </h4>
              </div>

              <div className="space-y-8">
                <div className="space-y-4">
                  <div className="flex items-center gap-2 opacity-60">
                    <Languages size={14} />
                    <span className="text-[10px] font-bold uppercase tracking-tight">
                      Output Language
                    </span>
                  </div>
                  <select
                    value={aiLanguage}
                    onChange={(e) => setAiLanguage(e.target.value)}
                    className="w-full bg-app-ink/5 border border-app-ink/10 p-3 text-[10px] font-mono uppercase tracking-widest focus:outline-none focus:border-app-ink/30 transition-all"
                  >
                    {LANGUAGES.map((l) => (
                      <option
                        key={l}
                        value={l}
                        className="bg-app-card text-app-ink"
                      >
                        {l.toUpperCase()}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] opacity-40 italic serif">
                    Summaries and chat responses will be generated in this
                    language.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center gap-2 opacity-60">
                    <Cpu size={14} />
                    <span className="text-[10px] font-bold uppercase tracking-tight">
                      Default Model
                    </span>
                  </div>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full bg-app-ink/5 border border-app-ink/10 p-3 text-[10px] font-mono uppercase tracking-widest focus:outline-none focus:border-app-ink/30 transition-all"
                  >
                    {MODELS.map((m) => (
                      <option
                        key={m.id}
                        value={m.id}
                        className="bg-app-card text-app-ink"
                      >
                        {m.label.toUpperCase()}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] opacity-40 italic serif">
                    Flash models are faster, Pro models are more detailed.
                  </p>
                </div>

                {advancedMode && (
                  <>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 opacity-60">
                          <Cpu size={14} />
                          <span className="text-[10px] font-bold uppercase tracking-tight">
                            Enable Embeddings & RAG
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setEmbeddingsEnabled(!embeddingsEnabled)
                          }
                          className={`w-10 h-5 transition-all relative border border-app-ink/20 ${embeddingsEnabled ? "bg-green-500 border-green-600" : "bg-app-ink/10"}`}
                        >
                          <div
                            className={`absolute top-0.5 w-3.5 h-3.5 bg-white transition-all ${embeddingsEnabled ? "left-5.5" : "left-0.5"}`}
                          />
                        </button>
                      </div>
                      <p className="text-[10px] opacity-40 italic serif">
                        Generate vector embeddings for posts to enable semantic
                        search and RAG chat. Warning: Takes significant disk
                        space.
                      </p>
                    </div>

                    {embeddingsEnabled && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 opacity-60">
                            <Database size={14} />
                            <span className="text-[10px] font-bold uppercase tracking-tight">
                              Pause Embedding Sync
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setEmbeddingsPaused(!embeddingsPaused)
                            }
                            className={`w-10 h-5 transition-all relative border border-app-ink/20 ${embeddingsPaused ? "bg-amber-500 border-amber-600" : "bg-app-ink/10"}`}
                          >
                            <div
                              className={`absolute top-0.5 w-3.5 h-3.5 bg-white transition-all ${embeddingsPaused ? "left-5.5" : "left-0.5"}`}
                            />
                          </button>
                        </div>
                        <p className="text-[10px] opacity-40 italic serif">
                          Temporarily pause the background generation of
                          embeddings to save API quota or CPU usage.
                        </p>
                      </div>
                    )}
                  </>
                )}

                <div className="space-y-4">
                  <div className="flex items-center gap-2 opacity-60">
                    <Thermometer size={14} />
                    <span className="text-[10px] font-bold uppercase tracking-tight">
                      Creativity (Temperature)
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step="any"
                      value={aiTemperature}
                      onChange={(e) => {
                        const val = Number.parseFloat(e.target.value)
                        if (!Number.isNaN(val)) {
                          setAiTemperature(Math.min(1, Math.max(0, val)))
                        }
                      }}
                      className="w-20 bg-app-ink/5 border border-app-ink/10 p-2 text-[10px] font-mono focus:outline-none focus:border-app-ink/30 transition-all rounded"
                    />
                    <span className="text-[10px] opacity-60 uppercase tracking-widest font-bold">
                      0 = precise · 1 = creative
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Translation Configuration */}
            {advancedMode && (
              <div className="bg-app-card border border-app-ink/10 p-6 shadow-sm mt-8">
                <div className="flex items-center gap-3 mb-6">
                  <Languages size={18} className="opacity-40" />
                  <h4 className="text-[11px] uppercase font-bold tracking-widest">
                    Translation Engine
                  </h4>
                </div>

                <div className="space-y-8">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 opacity-60">
                        <Languages size={14} />
                        <span className="text-[10px] font-bold uppercase tracking-tight">
                          Enable Translation
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setTranslationEnabled(!translationEnabled)
                        }
                        className={`w-10 h-5 transition-all relative border border-app-ink/20 ${translationEnabled ? "bg-green-500 border-green-600" : "bg-app-ink/10"}`}
                      >
                        <div
                          className={`absolute top-0.5 w-3.5 h-3.5 bg-white transition-all ${translationEnabled ? "left-5.5" : "left-0.5"}`}
                        />
                      </button>
                    </div>
                    <p className="text-[10px] opacity-40 italic serif">
                      Allow translating posts natively using Gemini.
                    </p>
                  </div>

                  <AnimatePresence>
                    {translationEnabled && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="space-y-6 overflow-hidden"
                      >
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 opacity-60">
                              <RefreshCw size={14} />
                              <span className="text-[10px] font-bold uppercase tracking-tight">
                                Auto-Translate Posts
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setAutoTranslate(!autoTranslate)}
                              className={`w-10 h-5 transition-all relative border border-app-ink/20 ${autoTranslate ? "bg-green-500 border-green-600" : "bg-app-ink/10"}`}
                            >
                              <div
                                className={`absolute top-0.5 w-3.5 h-3.5 bg-white transition-all ${autoTranslate ? "left-5.5" : "left-0.5"}`}
                              />
                            </button>
                          </div>
                          <p className="text-[10px] opacity-40 italic serif">
                            Automatically translate posts when they are loaded.
                          </p>
                        </div>

                        <div className="space-y-4">
                          <div className="flex items-center gap-2 opacity-60">
                            <Languages size={14} />
                            <span className="text-[10px] font-bold uppercase tracking-tight">
                              Target Language
                            </span>
                          </div>
                          <select
                            value={translationTargetLanguage}
                            onChange={(e) =>
                              setTranslationTargetLanguage(e.target.value)
                            }
                            className="w-full bg-app-ink/5 border border-app-ink/10 p-3 text-[10px] font-mono uppercase tracking-widest focus:outline-none focus:border-app-ink/30 transition-all"
                          >
                            {LANGUAGES.map((l) => (
                              <option
                                key={l}
                                value={l}
                                className="bg-app-card text-app-ink"
                              >
                                {l.toUpperCase()}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-4">
                          <div className="flex items-center gap-2 opacity-60">
                            <Cpu size={14} />
                            <span className="text-[10px] font-bold uppercase tracking-tight">
                              Translation Model
                            </span>
                          </div>
                          <select
                            value={translationModel}
                            onChange={(e) =>
                              setTranslationModel(e.target.value)
                            }
                            className="w-full bg-app-ink/5 border border-app-ink/10 p-3 text-[10px] font-mono uppercase tracking-widest focus:outline-none focus:border-app-ink/30 transition-all"
                          >
                            {MODELS.map((m) => (
                              <option
                                key={m.id}
                                value={m.id}
                                className="bg-app-card text-app-ink"
                              >
                                {m.label.toUpperCase()}
                              </option>
                            ))}
                          </select>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  )
}
