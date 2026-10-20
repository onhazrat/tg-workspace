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
import { toast } from "sonner"
import { api } from "@/api"
import { type Theme, useTheme } from "@/components/theme-provider"
import type { CardZoom } from "@/lib/channels/card-zoom"
import type { ActionLimit } from "@/lib/channels/selection-regions"
import type {
  DiscoverFollowState,
  DiscoverSignalWeights,
  DiscoverSortKey,
  DiscoverySignalKind,
} from "@/lib/posts/discover-candidates"
import { hydrateAppSettings } from "@/lib/settings/hydrate"
import {
  type AppSettings,
  type BackendSection,
  type CitationStyle,
  type SummaryTextSize,
  specFor,
} from "@/lib/settings/schema"
import { computeEffectiveGlobalStartTime } from "@/lib/settings/start-time"
import {
  buildSectionPayload,
  createAppSettingSetters,
  decodeServerSection,
  loadAppSettings,
  persistAppSettings,
  refusalMessage,
  sectionKeys,
  sectionValues,
} from "@/lib/settings/store"
import { useNetworkSettings } from "@/lib/settings/use-network-settings"
import { hasSession, scopedStorage } from "@/lib/storage/scoped"
import { isRTLLanguage } from "@/lib/utils"
import type { GlobalStartTimeMode, GlobalStartTimeValue } from "@/types"

interface SettingsContextType {
  /**
   * Re-read the section a settings key lives in, after a write made elsewhere
   * (the Settings page's registry write, SET-02). What it reads is what the
   * server holds, so it is not written back.
   */
  refreshSection: (key: string) => Promise<void>
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
  sharedLogRetentionDays: number
  setSharedLogRetentionDays: (days: number) => void
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
  channelCardZoom: CardZoom
  setChannelCardZoom: (zoom: CardZoom) => void
  channelGridGroupBySelection: boolean
  setChannelGridGroupBySelection: (group: boolean) => void
  directorySelectedFirst: boolean
  setDirectorySelectedFirst: (on: boolean) => void
  channelActionLimit: ActionLimit
  setChannelActionLimit: (limit: ActionLimit) => void
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
  workspaceFocusMode: boolean
  setWorkspaceFocusMode: (on: boolean) => void
  citationStyle: CitationStyle
  setCitationStyle: (style: CitationStyle) => void
  linkPreviews: boolean
  setLinkPreviews: (on: boolean) => void
  timeZone: string
  setTimeZone: (zone: string) => void
  summaryTextSize: SummaryTextSize
  setSummaryTextSize: (size: SummaryTextSize) => void
}

const SettingsContext = createContext<SettingsContextType | undefined>(
  undefined,
)

const sectionKey = (section: BackendSection, s: AppSettings) =>
  JSON.stringify(sectionValues(section, s))

/** The section `GET /data/settings/{section}` answers for each settings key. */
const SECTION_OF_KEY: Record<string, BackendSection> = {
  sync: "sync",
  sync_prefs: "sync",
  sync_runtime: "sync",
  retention: "retention",
  retention_prefs: "retention",
  translation: "translation",
  reach: "reach",
  publishing: "publishing",
  ai_prefs: "ai_prefs",
}

/** A section as the server answers it, over the schema's defaults. */
function readSection(
  section: BackendSection,
  value: Record<string, unknown>,
): Partial<AppSettings> {
  const updates: Partial<AppSettings> = {}
  for (const key of sectionKeys(section))
    Object.assign(updates, { [key]: specFor(key).defaultValue })
  const { defaults, ...stored } = value
  if (section === "ai_prefs" && defaults && typeof defaults === "object")
    Object.assign(
      updates,
      decodeServerSection(section, defaults as Record<string, unknown>),
    )
  return { ...updates, ...decodeServerSection(section, stored) }
}

function forgetStoredAiPrefs() {
  for (const key of sectionKeys("ai_prefs"))
    scopedStorage.removeItem(specFor(key).storageKey)
}

export const SettingsProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const { theme, resolvedTheme, setTheme: setGlobalTheme } = useTheme()

  // One-time migration of the legacy "theme" storage key into the provider.
  useEffect(() => {
    const legacy = scopedStorage.getItem("theme")
    if (legacy === "light" || legacy === "dark" || legacy === "system") {
      setGlobalTheme(legacy)
      scopedStorage.removeItem("theme")
    }
  }, [setGlobalTheme])

  const setTheme = (next: Theme) => setGlobalTheme(next)

  // All browser-persisted settings live in one schema-driven state object,
  // read through the per-account namespace rather than off bare `localStorage`.
  const [settings, setSettings] = useState<AppSettings>(() =>
    loadAppSettings(scopedStorage),
  )
  // Generated once — every setter keeps a stable identity across renders.
  const setters = useMemo(() => createAppSettingSetters(setSettings), [])

  // Persist changed keys (all of them on the first run).
  const prevSettings = useRef<AppSettings | null>(null)
  useEffect(() => {
    persistAppSettings(
      settings,
      scopedStorage,
      prevSettings.current ?? undefined,
    )
    prevSettings.current = settings
  }, [settings])

  const {
    network,
    setters: networkSetters,
    reload: reloadNetwork,
  } = useNetworkSettings()

  // Hydrate backend-synced sections once on mount: merge legacy browser-stored
  // values into the server payloads and write the merge back when needed.
  const appSettingsHydrated = useRef(false)
  // What each section is known to hold on the server, so applying what was
  // read (the AI preferences' hydration, any `refreshSection`) is not echoed
  // back as a write.
  const onServer = useRef<Partial<Record<BackendSection, string>>>({})
  const aiUploaded = useRef(false)

  const refreshSection = useCallback(
    async (key: string) => {
      if (key === "network") return reloadNetwork()
      const section = SECTION_OF_KEY[key]
      if (!section) return
      const { value } = await api.getSetting(section)
      setSettings((prev) => {
        const next = { ...prev, ...readSection(section, value) }
        onServer.current[section] = sectionKey(section, next)
        return next
      })
    },
    [reloadNetwork],
  )

  /** PUT a section unless it holds what the server is known to hold. */
  const pushSection = useCallback(
    (section: BackendSection, current: AppSettings) => {
      if (!hasSession() || !appSettingsHydrated.current) return null
      const known = sectionKey(section, current)
      if (onServer.current[section] === known) return null
      onServer.current[section] = known
      return api.putSetting(section, buildSectionPayload(section, current))
    },
    [],
  )
  useEffect(() => {
    if (typeof window === "undefined") return
    if (!hasSession()) return

    Promise.all([
      api.getSetting("sync"),
      api.getSetting("retention"),
      api.getSetting("translation"),
      api.getSetting("reach"),
      api.getSetting("publishing"),
      api.getSetting("ai_prefs"),
      // Optional, and the `catch` is the point. `GET /jobs/status` became
      // Admin-only in ticket 18, and one rejection inside `Promise.all` rejects
      // the whole thing: sync, retention and translation would never be
      // applied, `appSettingsHydrated` would never flip, and the three push
      // effects below it would stay disabled for the rest of the session — all
      // of it silent behind `.catch(console.error)`. The embeddings toggle is
      // the only thing this call feeds, so a non-Admin simply does not get it.
      api.jobsStatus().catch(() => null),
    ])
      .then(
        ([
          syncRow,
          retentionRow,
          translationRow,
          reachRow,
          publishingRow,
          aiPrefsRow,
          jobsStatus,
        ]) => {
          const { updates, writeBack, aiUpload } = hydrateAppSettings(
            {
              sync: syncRow.value,
              retention: retentionRow.value,
              translation: translationRow.value,
              reach: reachRow.value,
              publishing: publishingRow.value,
              ai_prefs: aiPrefsRow.value,
              jobsStatus,
            },
            scopedStorage,
            Intl.DateTimeFormat().resolvedOptions().timeZone,
          )
          setSettings((prev) => {
            const next = { ...prev, ...updates }
            onServer.current.ai_prefs = sectionKey("ai_prefs", next)
            return next
          })
          appSettingsHydrated.current = true
          // SET-05: the browser stops keeping the AI preferences once the
          // Account holds them, after the one upload when it held none. The
          // ref holds StrictMode's second hydration to that one upload.
          if (aiUpload && !aiUploaded.current) {
            aiUploaded.current = true
            api
              .putSetting("ai_prefs", aiUpload)
              .then(forgetStoredAiPrefs)
              .catch(console.error)
          } else if (!aiUpload) forgetStoredAiPrefs()
          if (writeBack) {
            api.putSetting("sync", writeBack.sync).catch(console.error)
            api
              .putSetting("retention", writeBack.retention)
              .catch(console.error)
          }
        },
      )
      .catch(console.error)
  }, [])

  // Push scheduler-related settings to Postgres for APScheduler jobs (Phase 6).
  useEffect(
    () => {
      pushSection("sync", settings)?.catch((err) =>
        console.warn("[Settings] Failed to sync scheduler settings:", err),
      )
    },
    sectionValues("sync", settings),
  )

  useEffect(
    () => {
      pushSection("retention", settings)?.catch((err) =>
        console.warn("[Settings] Failed to sync retention settings:", err),
      )
    },
    sectionValues("retention", settings),
  )

  useEffect(
    () => {
      pushSection("translation", settings)?.catch((err) =>
        console.warn("[Settings] Failed to sync translation settings:", err),
      )
    },
    sectionValues("translation", settings),
  )

  // Reach (REACH-03). The one section the server validates, so a refusal is
  // shown with the server's reason; one toast id so typing through an invalid
  // value on the way to a valid one replaces the message instead of stacking.
  useEffect(
    () => {
      pushSection("reach", settings)
        ?.then(() => toast.dismiss("reach-settings"))
        .catch((err) => {
          const refused = refusalMessage(err)
          if (refused) toast.error(refused, { id: "reach-settings" })
          else console.warn("[Settings] Failed to sync reach settings:", err)
        })
    },
    sectionValues("reach", settings),
  )

  // Publishing (SUMTAB-08). Also the write that saves the time zone the
  // hydration above filled from the browser.
  useEffect(
    () => {
      pushSection("publishing", settings)?.catch((err) =>
        console.warn("[Settings] Failed to sync publishing settings:", err),
      )
    },
    sectionValues("publishing", settings),
  )

  // AI preferences (SET-05), on the Account rather than in this browser.
  useEffect(
    () => {
      pushSection("ai_prefs", settings)?.catch((err) =>
        console.warn("[Settings] Failed to sync AI preferences:", err),
      )
    },
    sectionValues("ai_prefs", settings),
  )

  // Embeddings toggle maps onto the "embeddings" job rather than a section.
  useEffect(() => {
    if (!hasSession() || !appSettingsHydrated.current) return
    api
      .updateJob("embeddings", settings.embeddingsEnabled)
      .catch((err) =>
        console.warn("[Settings] Failed to sync embeddings job:", err),
      )
  }, [settings.embeddingsEnabled])

  // No client-side retention sweep any more. It existed to keep the IndexedDB
  // mirror inside the retention window; with the mirror gone, the backend's own
  // scheduled `job_retention` is the only sweep, and it is the authoritative
  // one. `postRetentionDays`/`logRetentionDays` still drive it server-side.

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
    refreshSection,
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
