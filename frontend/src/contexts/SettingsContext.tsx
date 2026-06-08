import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { DEFAULT_AI_LANGUAGE, DEFAULT_MODEL, AUTO_SYNC_INTERVAL_DEFAULT, THEME_DEFAULT } from "../constants";
import { isRTLLanguage } from "../lib/utils";
import { GlobalStartTimeMode, GlobalStartTimeValue } from "../types";

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
  proxyUrls: string;
  setProxyUrls: (urls: string) => void;
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
  torControlPassword: string;
  setTorControlPassword: (password: string) => void;
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
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("theme");
      return (saved as "light" | "dark") || THEME_DEFAULT;
    }
    return THEME_DEFAULT;
  });

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

  const [proxyEnabled, setProxyEnabled] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("proxyEnabled") === "true";
    }
    return false;
  });

  const [proxyUrls, setProxyUrls] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("proxyUrls") || "";
    }
    return "";
  });

  const [torEnabled, setTorEnabled] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("torEnabled") === "true";
    }
    return false;
  });

  const [torMode, setTorMode] = useState<"auto" | "custom">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("torMode");
      return (saved as "auto" | "custom") || "auto";
    }
    return "auto";
  });

  const [torProxyUrls, setTorProxyUrls] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("torProxyUrls") || "socks5h://127.0.0.1:9050";
    }
    return "socks5h://127.0.0.1:9050";
  });

  const [torRotationStrategy, setTorRotationStrategy] = useState<"sequential" | "random">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("torRotationStrategy");
      return (saved as "sequential" | "random") || "sequential";
    }
    return "sequential";
  });

  const [torControlEnabled, setTorControlEnabled] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("torControlEnabled") === "true";
    }
    return false;
  });

  const [torControlPort, setTorControlPort] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("torControlPort");
      return saved ? parseInt(saved, 10) : 9051;
    }
    return 9051;
  });

  const [torControlPassword, setTorControlPassword] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("torControlPassword") || "";
    }
    return "";
  });
  
  const [torAutoRotate, setTorAutoRotate] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("torAutoRotate") === "true";
    }
    return false;
  });

  const [torRotationThreshold, setTorRotationThreshold] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("torRotationThreshold");
      return saved ? parseInt(saved, 10) : 10;
    }
    return 10;
  });

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
    localStorage.setItem("theme", theme);
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("aiLanguage", aiLanguage);
  }, [aiLanguage]);

  useEffect(() => {
    localStorage.setItem("selectedModel", selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    localStorage.setItem("autoSyncEnabled", autoSyncEnabled.toString());
  }, [autoSyncEnabled]);

  useEffect(() => {
    localStorage.setItem("autoSyncInterval", autoSyncInterval.toString());
  }, [autoSyncInterval]);

  useEffect(() => {
    localStorage.setItem("aiTemperature", aiTemperature.toString());
  }, [aiTemperature]);

  useEffect(() => {
    localStorage.setItem("proxyEnabled", proxyEnabled.toString());
  }, [proxyEnabled]);

  useEffect(() => {
    localStorage.setItem("proxyUrls", proxyUrls);
  }, [proxyUrls]);

  useEffect(() => {
    localStorage.setItem("torEnabled", torEnabled.toString());
  }, [torEnabled]);

  useEffect(() => {
    localStorage.setItem("torMode", torMode);
  }, [torMode]);

  useEffect(() => {
    localStorage.setItem("torProxyUrls", torProxyUrls);
  }, [torProxyUrls]);

  useEffect(() => {
    localStorage.setItem("torRotationStrategy", torRotationStrategy);
  }, [torRotationStrategy]);

  useEffect(() => {
    localStorage.setItem("torControlEnabled", torControlEnabled.toString());
  }, [torControlEnabled]);

  useEffect(() => {
    localStorage.setItem("torControlPort", torControlPort.toString());
  }, [torControlPort]);

  useEffect(() => {
    localStorage.setItem("torControlPassword", torControlPassword);
  }, [torControlPassword]);

  useEffect(() => {
    localStorage.setItem("torAutoRotate", torAutoRotate.toString());
  }, [torAutoRotate]);

  useEffect(() => {
    localStorage.setItem("torRotationThreshold", torRotationThreshold.toString());
  }, [torRotationThreshold]);

  useEffect(() => {
    localStorage.setItem("syncConcurrency", syncConcurrency.toString());
  }, [syncConcurrency]);

  useEffect(() => {
    localStorage.setItem("embeddingsEnabled", embeddingsEnabled.toString());
  }, [embeddingsEnabled]);

  useEffect(() => {
    localStorage.setItem("embeddingsPaused", embeddingsPaused.toString());
  }, [embeddingsPaused]);

  useEffect(() => {
    localStorage.setItem("translationEnabled", translationEnabled.toString());
  }, [translationEnabled]);

  useEffect(() => {
    localStorage.setItem("autoTranslate", autoTranslate.toString());
  }, [autoTranslate]);

  useEffect(() => {
    localStorage.setItem("translationModel", translationModel);
  }, [translationModel]);

  useEffect(() => {
    localStorage.setItem("translationTargetLanguage", translationTargetLanguage);
  }, [translationTargetLanguage]);

  useEffect(() => {
    localStorage.setItem("autoFollowForwarded", autoFollowForwarded.toString());
  }, [autoFollowForwarded]);

  useEffect(() => {
    localStorage.setItem("postRetentionDays", postRetentionDays.toString());
  }, [postRetentionDays]);

  useEffect(() => {
    localStorage.setItem("logRetentionDays", logRetentionDays.toString());
  }, [logRetentionDays]);

  useEffect(() => {
    localStorage.setItem("globalStartTimeMode", globalStartTimeMode);
  }, [globalStartTimeMode]);

  useEffect(() => {
    localStorage.setItem("globalStartTimeValue", JSON.stringify(globalStartTimeValue));
  }, [globalStartTimeValue]);

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
        proxyUrls,
        setProxyUrls,
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
        torControlPassword,
        setTorControlPassword,
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
