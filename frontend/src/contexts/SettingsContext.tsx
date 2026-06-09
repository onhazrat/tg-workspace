import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from "react";
import { DEFAULT_AI_LANGUAGE, DEFAULT_MODEL, AUTO_SYNC_INTERVAL_DEFAULT } from "../constants";
import { useTheme } from "@/components/theme-provider";
import { isRTLLanguage } from "../lib/utils";
import { GlobalStartTimeMode, GlobalStartTimeValue } from "../types";
import { loadNetworkSettings, saveNetworkSettings } from "../lib/repository";
import { api } from "@/api";

interface SettingsContextType {
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
  aiLanguage: string;
  setAiLanguage: (language: string) => void;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  autoSyncEnabled: boolean;
  setAutoSyncEnabled: (enabled: boolean) => void;
  autoSyncInterval: number;
  setAutoSyncInterval: (interval: number) => void;
  aiTemperature: number;
  setAiTemperature: (temp: number) => void;
  isRTL: boolean;
  proxyEnabled: boolean;
  setProxyEnabled: (enabled: boolean) => void;
  defaultProxyUrls: string;
  setDefaultProxyUrls: (urls: string) => void;
  envFallbackConfigured: boolean;
  torAvailable: boolean;
  torEnabled: boolean;
  setTorEnabled: (enabled: boolean) => void;
  torMode: "auto" | "custom";
  setTorMode: (mode: "auto" | "custom") => void;
  torProxyUrls: string;
  setTorProxyUrls: (urls: string) => void;
  torRotationStrategy: "sequential" | "random";
  setTorRotationStrategy: (strategy: "sequential" | "random") => void;
  torControlEnabled: boolean;
  setTorControlEnabled: (enabled: boolean) => void;
  torControlPort: number;
  setTorControlPort: (port: number) => void;
  torAutoRotate: boolean;
  setTorAutoRotate: (enabled: boolean) => void;
  torRotationThreshold: number;
  setTorRotationThreshold: (threshold: number) => void;
  syncConcurrency: number;
  setSyncConcurrency: (count: number) => void;
  embeddingsEnabled: boolean;
  setEmbeddingsEnabled: (enabled: boolean) => void;
  embeddingsPaused: boolean;
  setEmbeddingsPaused: (paused: boolean) => void;
  translationEnabled: boolean;
  setTranslationEnabled: (enabled: boolean) => void;
  autoTranslate: boolean;
  setAutoTranslate: (enabled: boolean) => void;
  translationModel: string;
  setTranslationModel: (model: string) => void;
  translationTargetLanguage: string;
  setTranslationTargetLanguage: (language: string) => void;
  autoFollowForwarded: boolean;
  setAutoFollowForwarded: (enabled: boolean) => void;
  postRetentionDays: number;
  setPostRetentionDays: (days: number) => void;
  logRetentionDays: number;
  setLogRetentionDays: (days: number) => void;
  globalStartTimeMode: GlobalStartTimeMode;
  setGlobalStartTimeMode: (mode: GlobalStartTimeMode) => void;
  globalStartTimeValue: GlobalStartTimeValue;
  setGlobalStartTimeValue: (val: GlobalStartTimeValue) => void;
  getEffectiveGlobalStartTime: () => number;
  showChannelBio: boolean;
  setShowChannelBio: (show: boolean) => void;
  showChannelSubscribers: boolean;
  setShowChannelSubscribers: (show: boolean) => void;
  showChannelPhotos: boolean;
  setShowChannelPhotos: (show: boolean) => void;
  showChannelVideos: boolean;
  setShowChannelVideos: (show: boolean) => void;
  showChannelFiles: boolean;
  setShowChannelFiles: (show: boolean) => void;
  showChannelLinks: boolean;
  setShowChannelLinks: (show: boolean) => void;
  advancedMode: boolean;
  setAdvancedMode: (advanced: boolean) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { resolvedTheme, setTheme: setGlobalTheme } = useTheme();

  useEffect(() => {
    const legacy = localStorage.getItem("theme");
    if (legacy === "light" || legacy === "dark") {
      setGlobalTheme(legacy);
      localStorage.removeItem("theme");
    }
  }, [setGlobalTheme]);

  const theme = resolvedTheme;
  const setTheme = (next: "light" | "dark") => setGlobalTheme(next);

  const [aiLanguage, setAiLanguage] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("aiLanguage") || DEFAULT_AI_LANGUAGE;
    }
    return DEFAULT_AI_LANGUAGE;
  });

  const [selectedModel, setSelectedModel] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("selectedModel") || DEFAULT_MODEL;
    }
    return DEFAULT_MODEL;
  });

  const [autoSyncEnabled, setAutoSyncEnabled] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("autoSyncEnabled") === "true";
    }
    return false;
  });

  const [autoSyncInterval, setAutoSyncInterval] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("autoSyncInterval");
      return saved ? parseInt(saved, 10) : AUTO_SYNC_INTERVAL_DEFAULT;
    }
    return AUTO_SYNC_INTERVAL_DEFAULT;
  });

  const [aiTemperature, setAiTemperature] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("aiTemperature");
      return saved ? parseFloat(saved) : 0.7;
    }
    return 0.7;
  });

  const [proxyEnabled, setProxyEnabled] = useState<boolean>(false);

  const [defaultProxyUrls, setDefaultProxyUrls] = useState<string>("");

  const [envFallbackConfigured, setEnvFallbackConfigured] = useState<boolean>(false);

  const [torAvailable, setTorAvailable] = useState<boolean>(false);

  const [torEnabled, setTorEnabled] = useState<boolean>(false);

  const [torMode, setTorMode] = useState<"auto" | "custom">("auto");

  const [torProxyUrls, setTorProxyUrls] = useState<string>("socks5h://127.0.0.1:9050");

  const [torRotationStrategy, setTorRotationStrategy] = useState<"sequential" | "random">("sequential");

  const [torControlEnabled, setTorControlEnabled] = useState<boolean>(false);

  const [torControlPort, setTorControlPort] = useState<number>(9051);
  
  const [torAutoRotate, setTorAutoRotate] = useState<boolean>(false);

  const [torRotationThreshold, setTorRotationThreshold] = useState<number>(10);

  const [syncConcurrency, setSyncConcurrency] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("syncConcurrency");
      return saved ? parseInt(saved, 10) : 3;
    }
    return 3;
  });

  const [embeddingsEnabled, setEmbeddingsEnabled] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("embeddingsEnabled") === "true";
    }
    return false;
  });

  const [embeddingsPaused, setEmbeddingsPaused] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("embeddingsPaused") === "true";
    }
    return false;
  });

  const [translationEnabled, setTranslationEnabled] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("translationEnabled") === "true";
    }
    return false;
  });

  const [autoTranslate, setAutoTranslate] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("autoTranslate") === "true";
    }
    return false;
  });

  const [translationModel, setTranslationModel] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("translationModel") || DEFAULT_MODEL;
    }
    return DEFAULT_MODEL;
  });

  const [translationTargetLanguage, setTranslationTargetLanguage] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("translationTargetLanguage") || DEFAULT_AI_LANGUAGE;
    }
    return DEFAULT_AI_LANGUAGE;
  });

  const [autoFollowForwarded, setAutoFollowForwarded] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("autoFollowForwarded") === "true";
    }
    return false;
  });

  const [postRetentionDays, setPostRetentionDays] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("postRetentionDays");
      return saved ? parseInt(saved, 10) : 0;
    }
    return 0;
  });

  const [logRetentionDays, setLogRetentionDays] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("logRetentionDays");
      return saved ? parseInt(saved, 10) : 0;
    }
    return 0;
  });

  const [globalStartTimeMode, setGlobalStartTimeMode] = useState<GlobalStartTimeMode>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("globalStartTimeMode");
      return (saved as GlobalStartTimeMode) || "retention";
    }
    return "retention";
  });

  const [globalStartTimeValue, setGlobalStartTimeValue] = useState<GlobalStartTimeValue>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("globalStartTimeValue");
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          return null;
        }
      }
    }
    return null;
  });

  const [showChannelBio, setShowChannelBio] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("showChannelBio");
      return saved !== null ? saved === "true" : true;
    }
    return true;
  });

  const [showChannelSubscribers, setShowChannelSubscribers] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("showChannelSubscribers");
      return saved !== null ? saved === "true" : true;
    }
    return true;
  });

  const [showChannelPhotos, setShowChannelPhotos] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("showChannelPhotos");
      return saved !== null ? saved === "true" : false;
    }
    return false;
  });

  const [showChannelVideos, setShowChannelVideos] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("showChannelVideos");
      return saved !== null ? saved === "true" : false;
    }
    return false;
  });

  const [showChannelFiles, setShowChannelFiles] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("showChannelFiles");
      return saved !== null ? saved === "true" : false;
    }
    return false;
  });

  const [showChannelLinks, setShowChannelLinks] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("showChannelLinks");
      return saved !== null ? saved === "true" : false;
    }
    return false;
  });

  const [advancedMode, setAdvancedMode] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("advancedMode");
      return saved !== null ? saved === "true" : false;
    }
    return false;
  });

  const networkHydrated = useRef(false);
  const appSettingsHydrated = useRef(false);
  const networkSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyAppSettings = useCallback((sync: Record<string, unknown>, retention: Record<string, unknown>, translation: Record<string, unknown>) => {
    if (typeof sync.autoSyncEnabled === "boolean") setAutoSyncEnabled(sync.autoSyncEnabled);
    if (typeof sync.autoSyncInterval === "number") setAutoSyncInterval(sync.autoSyncInterval);
    if (typeof sync.syncConcurrency === "number") setSyncConcurrency(sync.syncConcurrency);
    if (typeof sync.autoFollowForwarded === "boolean") setAutoFollowForwarded(sync.autoFollowForwarded);
    if (sync.globalStartTimeMode === "retention" || sync.globalStartTimeMode === "relative" || sync.globalStartTimeMode === "absolute") {
      setGlobalStartTimeMode(sync.globalStartTimeMode);
    }
    if (sync.globalStartTimeValue !== undefined) setGlobalStartTimeValue(sync.globalStartTimeValue as GlobalStartTimeValue);
    if (typeof retention.postRetentionDays === "number") setPostRetentionDays(retention.postRetentionDays);
    if (typeof retention.logRetentionDays === "number") setLogRetentionDays(retention.logRetentionDays);
    if (typeof translation.translationEnabled === "boolean") setTranslationEnabled(translation.translationEnabled);
    if (typeof translation.autoTranslate === "boolean") setAutoTranslate(translation.autoTranslate);
    if (typeof translation.translationModel === "string") setTranslationModel(translation.translationModel);
    if (typeof translation.translationTargetLanguage === "string") setTranslationTargetLanguage(translation.translationTargetLanguage);
  }, []);

  const applyNetworkSettings = useCallback((value: Record<string, unknown>) => {
    if (Array.isArray(value.proxyUrls)) {
      setDefaultProxyUrls((value.proxyUrls as string[]).join("\n"));
    } else if (typeof value.defaultProxyUrls === "string") {
      setDefaultProxyUrls(value.defaultProxyUrls);
    }
    if (typeof value.envFallbackConfigured === "boolean") {
      setEnvFallbackConfigured(value.envFallbackConfigured);
    }
    if (typeof value.torAvailable === "boolean") setTorAvailable(value.torAvailable);
    if (typeof value.proxyEnabled === "boolean") setProxyEnabled(value.proxyEnabled);
    if (typeof value.torEnabled === "boolean") setTorEnabled(value.torEnabled);
    if (value.torMode === "auto" || value.torMode === "custom") setTorMode(value.torMode);
    if (typeof value.torProxyUrls === "string") setTorProxyUrls(value.torProxyUrls);
    if (value.torRotationStrategy === "sequential" || value.torRotationStrategy === "random") {
      setTorRotationStrategy(value.torRotationStrategy);
    }
    if (typeof value.torControlEnabled === "boolean") setTorControlEnabled(value.torControlEnabled);
    if (typeof value.torControlPort === "number") setTorControlPort(value.torControlPort);
    if (typeof value.torAutoRotate === "boolean") setTorAutoRotate(value.torAutoRotate);
    if (typeof value.torRotationThreshold === "number") setTorRotationThreshold(value.torRotationThreshold);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.removeItem("proxyUrls");
    localStorage.removeItem("torControlPassword");

    if (!localStorage.getItem("access_token")) return;

    loadNetworkSettings()
      .then((value) => {
        const legacy: Record<string, unknown> = {};
        const legacyProxyEnabled = localStorage.getItem("proxyEnabled");
        if (legacyProxyEnabled !== null && value.proxyEnabled === undefined) {
          legacy.proxyEnabled = legacyProxyEnabled === "true";
        }
        const legacyTorEnabled = localStorage.getItem("torEnabled");
        if (legacyTorEnabled !== null && value.torEnabled === undefined) {
          legacy.torEnabled = legacyTorEnabled === "true";
        }
        applyNetworkSettings({ ...value, ...legacy });
        networkHydrated.current = true;
        if (Object.keys(legacy).length > 0) {
          const proxyUrls = defaultProxyUrls
            .split(/[\n,]+/)
            .map((p) => p.trim())
            .filter(Boolean);
          saveNetworkSettings({
            proxyEnabled: legacy.proxyEnabled as boolean,
            proxyUrls,
            torEnabled: legacy.torEnabled as boolean,
            torMode,
            torProxyUrls,
            torRotationStrategy,
            torControlEnabled,
            torControlPort,
            torAutoRotate,
            torRotationThreshold,
          }).catch(console.error);
        }
      })
      .catch(console.error);
  }, [applyNetworkSettings, torAutoRotate, torControlEnabled, torControlPort, torMode, torProxyUrls, torRotationStrategy, torRotationThreshold]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem("access_token")) return;

    Promise.all([
      api.getSetting("sync"),
      api.getSetting("retention"),
      api.getSetting("translation"),
    ])
      .then(([syncRow, retentionRow, translationRow]) => {
        const sync = syncRow.value ?? {};
        const retention = retentionRow.value ?? {};
        const translation = translationRow.value ?? {};
        const legacy: { sync: Record<string, unknown>; retention: Record<string, unknown>; translation: Record<string, unknown> } = {
          sync: {},
          retention: {},
          translation: {},
        };
        const legacyAutoSync = localStorage.getItem("autoSyncEnabled");
        if (legacyAutoSync !== null && sync.autoSyncEnabled === undefined) {
          legacy.sync.autoSyncEnabled = legacyAutoSync === "true";
        }
        const legacyInterval = localStorage.getItem("autoSyncInterval");
        if (legacyInterval !== null && sync.autoSyncInterval === undefined) {
          legacy.sync.autoSyncInterval = parseInt(legacyInterval, 10);
        }
        const legacyPostRetention = localStorage.getItem("postRetentionDays");
        if (legacyPostRetention !== null && retention.postRetentionDays === undefined) {
          legacy.retention.postRetentionDays = parseInt(legacyPostRetention, 10);
        }
        applyAppSettings(
          { ...sync, ...legacy.sync },
          { ...retention, ...legacy.retention },
          { ...translation, ...legacy.translation }
        );
        appSettingsHydrated.current = true;
        if (Object.keys(legacy.sync).length > 0 || Object.keys(legacy.retention).length > 0) {
          api.putSetting("sync", { ...sync, ...legacy.sync }).catch(console.error);
          api.putSetting("retention", { ...retention, ...legacy.retention }).catch(console.error);
        }
      })
      .catch(console.error);
  }, [applyAppSettings]);

  useEffect(() => {
    if (!networkHydrated.current || !localStorage.getItem("access_token")) return;
    if (networkSaveTimer.current) clearTimeout(networkSaveTimer.current);
    networkSaveTimer.current = setTimeout(() => {
      const proxyUrls = defaultProxyUrls
        .split(/[\n,]+/)
        .map((p) => p.trim())
        .filter(Boolean);
      saveNetworkSettings({
        proxyEnabled,
        proxyUrls,
        torEnabled,
        torMode,
        torProxyUrls,
        torRotationStrategy,
        torControlEnabled,
        torControlPort,
        torAutoRotate,
        torRotationThreshold,
      }).catch(console.error);
    }, 400);
    return () => {
      if (networkSaveTimer.current) clearTimeout(networkSaveTimer.current);
    };
  }, [
    proxyEnabled,
    defaultProxyUrls,
    torEnabled,
    torMode,
    torProxyUrls,
    torRotationStrategy,
    torControlEnabled,
    torControlPort,
    torAutoRotate,
    torRotationThreshold,
  ]);

  const getEffectiveGlobalStartTime = useCallback(() => {
    const now = Date.now();
    let targetTime = now;
    
    if (globalStartTimeMode === "retention") {
      if (postRetentionDays > 0) {
        targetTime = now - postRetentionDays * 24 * 60 * 60 * 1000;
      } else {
        targetTime = 0; // No retention limit
      }
    } else if (globalStartTimeMode === "relative") {
      const days = typeof globalStartTimeValue === "number" ? globalStartTimeValue : 7;
      targetTime = now - days * 24 * 60 * 60 * 1000;
    } else if (globalStartTimeMode === "absolute") {
      const dateStr = typeof globalStartTimeValue === "string" ? globalStartTimeValue : new Date().toISOString();
      targetTime = new Date(dateStr).getTime();
      if (isNaN(targetTime)) {
        targetTime = now;
      }
    }

    // Clamp to retention policy
    if (postRetentionDays > 0) {
      const minAllowedTime = now - postRetentionDays * 24 * 60 * 60 * 1000;
      if (targetTime < minAllowedTime) {
        targetTime = minAllowedTime;
      }
    }

    return targetTime;
  }, [globalStartTimeMode, globalStartTimeValue, postRetentionDays]);

  useEffect(() => {
    localStorage.setItem("aiLanguage", aiLanguage);
  }, [aiLanguage]);

  useEffect(() => {
    localStorage.setItem("selectedModel", selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    localStorage.setItem("aiTemperature", aiTemperature.toString());
  }, [aiTemperature]);

  useEffect(() => {
    localStorage.setItem("embeddingsEnabled", embeddingsEnabled.toString());
  }, [embeddingsEnabled]);

  useEffect(() => {
    localStorage.setItem("embeddingsPaused", embeddingsPaused.toString());
  }, [embeddingsPaused]);

  useEffect(() => {
    localStorage.setItem("showChannelBio", showChannelBio.toString());
  }, [showChannelBio]);

  useEffect(() => {
    localStorage.setItem("showChannelSubscribers", showChannelSubscribers.toString());
  }, [showChannelSubscribers]);

  useEffect(() => {
    localStorage.setItem("showChannelPhotos", showChannelPhotos.toString());
  }, [showChannelPhotos]);

  useEffect(() => {
    localStorage.setItem("showChannelVideos", showChannelVideos.toString());
  }, [showChannelVideos]);

  useEffect(() => {
    localStorage.setItem("showChannelFiles", showChannelFiles.toString());
  }, [showChannelFiles]);

  useEffect(() => {
    localStorage.setItem("showChannelLinks", showChannelLinks.toString());
  }, [showChannelLinks]);

  useEffect(() => {
    localStorage.setItem("advancedMode", advancedMode.toString());
  }, [advancedMode]);

  // Push scheduler-related settings to Postgres for APScheduler jobs (Phase 6).
  useEffect(() => {
    if (!localStorage.getItem("access_token") || !appSettingsHydrated.current) return;
    api
      .putSetting("sync", {
        autoSyncEnabled,
        autoSyncInterval,
        syncConcurrency,
        autoFollowForwarded,
        globalStartTimeMode,
        globalStartTimeValue,
      })
      .catch((err) => console.warn("[Settings] Failed to sync scheduler settings:", err));
  }, [
    autoSyncEnabled,
    autoSyncInterval,
    syncConcurrency,
    autoFollowForwarded,
    globalStartTimeMode,
    globalStartTimeValue,
  ]);

  useEffect(() => {
    if (!localStorage.getItem("access_token") || !appSettingsHydrated.current) return;
    api
      .putSetting("retention", { postRetentionDays, logRetentionDays })
      .catch((err) => console.warn("[Settings] Failed to sync retention settings:", err));
  }, [postRetentionDays, logRetentionDays]);

  useEffect(() => {
    if (!localStorage.getItem("access_token") || !appSettingsHydrated.current) return;
    api
      .putSetting("translation", {
        translationEnabled,
        autoTranslate,
        translationModel,
        translationTargetLanguage,
      })
      .catch((err) => console.warn("[Settings] Failed to sync translation settings:", err));
  }, [translationEnabled, autoTranslate, translationModel, translationTargetLanguage]);

  const isRTL = isRTLLanguage(aiLanguage);

  return (
    <SettingsContext.Provider
      value={{
        theme,
        setTheme,
        aiLanguage,
        setAiLanguage,
        selectedModel,
        setSelectedModel,
        autoSyncEnabled,
        setAutoSyncEnabled,
        autoSyncInterval,
        setAutoSyncInterval,
        aiTemperature,
        setAiTemperature,
        isRTL,
        proxyEnabled,
        setProxyEnabled,
        defaultProxyUrls,
        setDefaultProxyUrls,
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
        autoFollowForwarded,
        setAutoFollowForwarded,
        postRetentionDays,
        setPostRetentionDays,
        logRetentionDays,
        setLogRetentionDays,
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
        advancedMode,
        setAdvancedMode,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
};
