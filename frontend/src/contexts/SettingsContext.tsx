import type React from "react"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { api } from "@/api"
import { type Theme, useTheme } from "@/components/theme-provider"
import {
  RETENTION_LOG_DAYS_DEFAULT,
  RETENTION_PAYLOAD_DAYS_DEFAULT,
  RETENTION_POST_DAYS_DEFAULT,
} from "@/constants"
import { useCachePrune } from "@/hooks/useCachePrune"
import type {
  DiscoverFollowState,
  DiscoverSignalWeights,
  DiscoverSortKey,
  DiscoverySignalKind,
} from "@/lib/posts/discover-candidates"
import type { AppSettings } from "@/lib/settings/schema"
import { computeEffectiveGlobalStartTime } from "@/lib/settings/start-time"
import {
  buildSectionPayload,
  createAppSettingSetters,
  decodeServerSection,
  loadAppSettings,
  persistAppSettings,
  sectionValues,
} from "@/lib/settings/store"
import { useNetworkSettings } from "@/lib/settings/use-network-settings"
import { isRTLLanguage } from "@/lib/utils"
import type { GlobalStartTimeMode, GlobalStartTimeValue } from "@/types"

interface SettingsContextType {
  theme: Theme
  resolvedTheme: "light" | "dark"
  setTheme: (theme: Theme) => void
  aiLanguage: string
  setAiLanguage: (language: string) => void
  selectedModel: string
  setSelectedModel: (model: string) => void
  regularSyncIntervalMinutes: number
  setRegularSyncIntervalMinutes: (interval: number) => void
  dynamicSyncEnabledDefault: boolean
  setDynamicSyncEnabledDefault: (enabled: boolean) => void
  dynamicSyncExpectedPostsDefault: number
  setDynamicSyncExpectedPostsDefault: (posts: number) => void
  syncFailureBackoffMinutes: number
  setSyncFailureBackoffMinutes: (minutes: number) => void
  aiTemperature: number
  setAiTemperature: (temp: number) => void
  isRTL: boolean
  proxyEnabled: boolean
  setProxyEnabled: (enabled: boolean) => void
  defaultProxyUrls: string
  setDefaultProxyUrls: (urls: string) => void
  proxyDefaultConcurrency: number
  setProxyDefaultConcurrency: (slots: number) => void
  proxyConcurrencyOverrides: Record<string, number>
  setProxyConcurrencyOverrides: (overrides: Record<string, number>) => void
  envFallbackConfigured: boolean
  torAvailable: boolean
  torEnabled: boolean
  setTorEnabled: (enabled: boolean) => void
  torMode: "auto" | "custom"
  setTorMode: (mode: "auto" | "custom") => void
  torProxyUrls: string
  setTorProxyUrls: (urls: string) => void
  torRotationStrategy: "sequential" | "random"
  setTorRotationStrategy: (strategy: "sequential" | "random") => void
  torControlEnabled: boolean
  setTorControlEnabled: (enabled: boolean) => void
  torControlPort: number
  setTorControlPort: (port: number) => void
  torAutoRotate: boolean
  setTorAutoRotate: (enabled: boolean) => void
  torRotationThreshold: number
  setTorRotationThreshold: (threshold: number) => void
  syncConcurrency: number
  setSyncConcurrency: (count: number) => void
  embeddingsEnabled: boolean
  setEmbeddingsEnabled: (enabled: boolean) => void
  embeddingsPaused: boolean
  setEmbeddingsPaused: (paused: boolean) => void
  translationEnabled: boolean
  setTranslationEnabled: (enabled: boolean) => void
  autoTranslate: boolean
  setAutoTranslate: (enabled: boolean) => void
  translationModel: string
  setTranslationModel: (model: string) => void
  translationTargetLanguage: string
  setTranslationTargetLanguage: (language: string) => void
  postRetentionDays: number
  setPostRetentionDays: (days: number) => void
  logRetentionDays: number
  setLogRetentionDays: (days: number) => void
  payloadRetentionDays: number
  setPayloadRetentionDays: (days: number) => void
  reportRetentionDays: number
  setReportRetentionDays: (days: number) => void
  reportRetentionMax: number
  setReportRetentionMax: (count: number) => void
  globalStartTimeMode: GlobalStartTimeMode
  setGlobalStartTimeMode: (mode: GlobalStartTimeMode) => void
  globalStartTimeValue: GlobalStartTimeValue
  setGlobalStartTimeValue: (val: GlobalStartTimeValue) => void
  getEffectiveGlobalStartTime: () => number
  showChannelBio: boolean
  setShowChannelBio: (show: boolean) => void
  showChannelSubscribers: boolean
  setShowChannelSubscribers: (show: boolean) => void
  showChannelTelegramChatId: boolean
  setShowChannelTelegramChatId: (show: boolean) => void
  showChannelPhotos: boolean
  setShowChannelPhotos: (show: boolean) => void
  showChannelVideos: boolean
  setShowChannelVideos: (show: boolean) => void
  showChannelFiles: boolean
  setShowChannelFiles: (show: boolean) => void
  showChannelLinks: boolean
  setShowChannelLinks: (show: boolean) => void
  showChannelStartId: boolean
  setShowChannelStartId: (show: boolean) => void
  discoverSignals: DiscoverySignalKind[]
  setDiscoverSignals: (kinds: DiscoverySignalKind[]) => void
  discoverSortKey: DiscoverSortKey
  setDiscoverSortKey: (key: DiscoverSortKey) => void
  discoverFollowState: DiscoverFollowState
  setDiscoverFollowState: (state: DiscoverFollowState) => void
  discoverMinTotal: number
  setDiscoverMinTotal: (minTotal: number) => void
  discoverSignalWeights: DiscoverSignalWeights
  setDiscoverSignalWeights: (weights: DiscoverSignalWeights) => void
}

const SettingsContext = createContext<SettingsContextType | undefined>(
  undefined,
)

export const SettingsProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const { theme, resolvedTheme, setTheme: setGlobalTheme } = useTheme()

  // One-time migration of the legacy "theme" localStorage key into the provider.
  useEffect(() => {
    const legacy = localStorage.getItem("theme")
    if (legacy === "light" || legacy === "dark" || legacy === "system") {
      setGlobalTheme(legacy)
      localStorage.removeItem("theme")
    }
  }, [setGlobalTheme])

  const setTheme = (next: Theme) => setGlobalTheme(next)

  // All localStorage-backed settings live in one schema-driven state object.
  const [settings, setSettings] = useState<AppSettings>(() =>
    loadAppSettings(
      typeof window !== "undefined" ? localStorage : { getItem: () => null },
    ),
  )
  // Generated once — every setter keeps a stable identity across renders.
  const setters = useMemo(() => createAppSettingSetters(setSettings), [])

  // Persist changed keys to localStorage (all keys on the first run).
  const prevSettings = useRef<AppSettings | null>(null)
  useEffect(() => {
    persistAppSettings(
      settings,
      localStorage,
      prevSettings.current ?? undefined,
    )
    prevSettings.current = settings
  }, [settings])

  const { network, setters: networkSetters } = useNetworkSettings()

  // Hydrate backend-synced sections once on mount: merge legacy localStorage
  // values into the server payloads and write the merge back when needed.
  const appSettingsHydrated = useRef(false)
  useEffect(() => {
    if (typeof window === "undefined") return
    if (!localStorage.getItem("access_token")) return

    Promise.all([
      api.getSetting("sync"),
      api.getSetting("retention"),
      api.getSetting("translation"),
      api.jobsStatus(),
    ])
      .then(([syncRow, retentionRow, translationRow, jobsStatus]) => {
        const sync = syncRow.value ?? {}
        const retention = retentionRow.value ?? {}
        const translation = translationRow.value ?? {}
        const legacySync: Record<string, unknown> = {}
        const legacyRetention: Record<string, unknown> = {}
        const legacyInterval = localStorage.getItem("autoSyncInterval")
        if (
          legacyInterval !== null &&
          sync.regularSyncIntervalMinutes === undefined
        ) {
          legacySync.regularSyncIntervalMinutes = Number.parseInt(
            legacyInterval,
            10,
          )
        }
        const legacyPostRetention = localStorage.getItem("postRetentionDays")
        if (
          legacyPostRetention !== null &&
          retention.postRetentionDays === undefined
        ) {
          legacyRetention.postRetentionDays = Number.parseInt(
            legacyPostRetention,
            10,
          )
        }
        const updates: Partial<AppSettings> = {
          ...decodeServerSection("sync", { ...sync, ...legacySync }),
          ...decodeServerSection("retention", {
            postRetentionDays: RETENTION_POST_DAYS_DEFAULT,
            logRetentionDays: RETENTION_LOG_DAYS_DEFAULT,
            payloadRetentionDays: RETENTION_PAYLOAD_DAYS_DEFAULT,
            ...retention,
            ...legacyRetention,
          }),
          ...decodeServerSection("translation", translation),
        }
        if (typeof jobsStatus.embeddings?.enabled === "boolean") {
          updates.embeddingsEnabled = jobsStatus.embeddings.enabled
        }
        setSettings((prev) => ({ ...prev, ...updates }))
        appSettingsHydrated.current = true
        if (
          Object.keys(legacySync).length > 0 ||
          Object.keys(legacyRetention).length > 0
        ) {
          api
            .putSetting("sync", { ...sync, ...legacySync })
            .catch(console.error)
          api
            .putSetting("retention", { ...retention, ...legacyRetention })
            .catch(console.error)
        }
      })
      .catch(console.error)
  }, [])

  // Push scheduler-related settings to Postgres for APScheduler jobs (Phase 6).
  useEffect(
    () => {
      if (!localStorage.getItem("access_token") || !appSettingsHydrated.current)
        return
      api
        .putSetting("sync", buildSectionPayload("sync", settings))
        .catch((err) =>
          console.warn("[Settings] Failed to sync scheduler settings:", err),
        )
    },
    sectionValues("sync", settings),
  )

  useEffect(
    () => {
      if (!localStorage.getItem("access_token") || !appSettingsHydrated.current)
        return
      api
        .putSetting("retention", buildSectionPayload("retention", settings))
        .catch((err) =>
          console.warn("[Settings] Failed to sync retention settings:", err),
        )
    },
    sectionValues("retention", settings),
  )

  useEffect(
    () => {
      if (!localStorage.getItem("access_token") || !appSettingsHydrated.current)
        return
      api
        .putSetting("translation", buildSectionPayload("translation", settings))
        .catch((err) =>
          console.warn("[Settings] Failed to sync translation settings:", err),
        )
    },
    sectionValues("translation", settings),
  )

  // Embeddings toggle maps onto the "embeddings" job rather than a section.
  useEffect(() => {
    if (!localStorage.getItem("access_token") || !appSettingsHydrated.current)
      return
    api
      .updateJob("embeddings", settings.embeddingsEnabled)
      .catch((err) =>
        console.warn("[Settings] Failed to sync embeddings job:", err),
      )
  }, [settings.embeddingsEnabled])

  // Keep the IndexedDB mirror inside the retention window; without this it
  // grows forever, independent of the backend's own sweep.
  useCachePrune(settings.postRetentionDays, settings.logRetentionDays)

  const getEffectiveGlobalStartTime = useCallback(
    () =>
      computeEffectiveGlobalStartTime(
        settings.globalStartTimeMode,
        settings.globalStartTimeValue,
        settings.postRetentionDays,
      ),
    [
      settings.globalStartTimeMode,
      settings.globalStartTimeValue,
      settings.postRetentionDays,
    ],
  )

  const isRTL = isRTLLanguage(settings.aiLanguage)

  const value: SettingsContextType = {
    theme,
    resolvedTheme,
    setTheme,
    isRTL,
    getEffectiveGlobalStartTime,
    ...settings,
    ...setters,
    ...network,
    ...networkSetters,
  }

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  )
}

export const useSettings = () => {
  const context = useContext(SettingsContext)
  if (context === undefined) {
    throw new Error("useSettings must be used within a SettingsProvider")
  }
  return context
}
