import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { Channel, BotCredential, ChatDestination, ChannelStats, Summary, DBStats, PublishLog, SyncLog, LLMLog, EmbeddingLog, NetworkLog } from "../types";
import { normalizeChannel } from "../lib/channelNormalize";
import {
  listChannels,
  listBotCredentials,
  listChatDestinations,
  getDBStats,
  getChannelStats,
  listSummaries,
  listPublishLogs,
  listSyncLogs,
  listLLMLogs,
  listEmbeddingLogs,
  listNetworkLogs,
  cleanupLegacyBots,
} from "../lib/repository";

interface DataContextType {
  channels: Channel[];
  setChannels: React.Dispatch<React.SetStateAction<Channel[]>>;
  loadChannels: () => Promise<void>;
  
  botCredentials: BotCredential[];
  setBotCredentials: React.Dispatch<React.SetStateAction<BotCredential[]>>;
  
  chatDestinations: ChatDestination[];
  setChatDestinations: React.Dispatch<React.SetStateAction<ChatDestination[]>>;
  loadBots: () => Promise<void>;
  
  channelStats: Record<string, ChannelStats>;
  setChannelStats: React.Dispatch<React.SetStateAction<Record<string, ChannelStats>>>;

  summariesHistory: Summary[];
  setSummariesHistory: React.Dispatch<React.SetStateAction<Summary[]>>;
  loadHistory: () => Promise<void>;

  dbStats: DBStats | null;
  setDbStats: React.Dispatch<React.SetStateAction<DBStats | null>>;
  loadDBStats: () => Promise<void>;

  publishLogs: PublishLog[];
  setPublishLogs: React.Dispatch<React.SetStateAction<PublishLog[]>>;
  loadLogs: () => Promise<void>;

  syncLogs: SyncLog[];
  setSyncLogs: React.Dispatch<React.SetStateAction<SyncLog[]>>;
  loadSyncLogs: () => Promise<void>;

  llmLogs: LLMLog[];
  setLlmLogs: React.Dispatch<React.SetStateAction<LLMLog[]>>;
  loadLLMLogs: () => Promise<void>;

  embeddingLogs: EmbeddingLog[];
  setEmbeddingLogs: React.Dispatch<React.SetStateAction<EmbeddingLog[]>>;
  loadEmbeddingLogs: () => Promise<void>;

  networkLogs: NetworkLog[];
  setNetworkLogs: React.Dispatch<React.SetStateAction<NetworkLog[]>>;
  loadNetworkLogs: () => Promise<void>;

  selectedChannels: Set<string>;
  setSelectedChannels: React.Dispatch<React.SetStateAction<Set<string>>>;

  prevChannelNames: Set<string>;
  setPrevChannelNames: React.Dispatch<React.SetStateAction<Set<string>>>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [botCredentials, setBotCredentials] = useState<BotCredential[]>([]);
  const [chatDestinations, setChatDestinations] = useState<ChatDestination[]>([]);
  const [channelStats, setChannelStats] = useState<Record<string, ChannelStats>>({});
  const [summariesHistory, setSummariesHistory] = useState<Summary[]>([]);
  const [dbStats, setDbStats] = useState<DBStats | null>(null);
  const [publishLogs, setPublishLogs] = useState<PublishLog[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [llmLogs, setLlmLogs] = useState<LLMLog[]>([]);
  const [embeddingLogs, setEmbeddingLogs] = useState<EmbeddingLog[]>([]);
  const [networkLogs, setNetworkLogs] = useState<NetworkLog[]>([]);

  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("selectedChannels");
      try {
        return saved ? new Set(JSON.parse(saved)) : new Set();
      } catch {
        return new Set();
      }
    }
    return new Set();
  });

  const [prevChannelNames, setPrevChannelNames] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("prevChannelNames");
      try {
        return saved ? new Set(JSON.parse(saved)) : new Set();
      } catch {
        return new Set();
      }
    }
    return new Set();
  });

  useEffect(() => {
    localStorage.setItem("selectedChannels", JSON.stringify(Array.from(selectedChannels)));
  }, [selectedChannels]);

  useEffect(() => {
    localStorage.setItem("prevChannelNames", JSON.stringify(Array.from(prevChannelNames)));
  }, [prevChannelNames]);

  const loadChannels = useCallback(async () => {
    const storedChannels = await listChannels();
    const normalizedChannels = storedChannels.map(normalizeChannel);
    setChannels(normalizedChannels);
    
    const names = normalizedChannels.map(c => c.name);
    
    setPrevChannelNames(prevNames => {
      setSelectedChannels(currentSelected => {
        const nextSelected = new Set(currentSelected);
        names.forEach(name => {
          if (!prevNames.has(name)) {
            nextSelected.add(name);
          }
        });
        const namesSet = new Set(names);
        Array.from(nextSelected).forEach(selectedName => {
          if (!namesSet.has(selectedName)) {
            nextSelected.delete(selectedName);
          }
        });
        return nextSelected;
      });
      
      return new Set(names);
    });
    
    const stats: Record<string, ChannelStats> = {};
    for (const channel of normalizedChannels) {
      const s = await getChannelStats(channel.id, channel.name);
      if (s) stats[channel.name] = s;
    }
    setChannelStats(stats);
  }, []);

  const loadBots = useCallback(async () => {
    const credentials = await listBotCredentials();
    const destinations = await listChatDestinations();
    setBotCredentials(credentials);
    setChatDestinations(destinations);
    
    await cleanupLegacyBots();
    setBotCredentials(await listBotCredentials());
    setChatDestinations(await listChatDestinations());
  }, []);

  const loadHistory = useCallback(async () => {
    const history = await listSummaries();
    setSummariesHistory(history.sort((a, b) => b.timestamp - a.timestamp));
  }, []);

  const loadLogs = useCallback(async () => {
    const logs = await listPublishLogs();
    setPublishLogs(logs.sort((a, b) => b.timestamp - a.timestamp));
  }, []);

  const loadSyncLogs = useCallback(async () => {
    const logs = await listSyncLogs();
    setSyncLogs(logs.sort((a, b) => b.timestamp - a.timestamp));
  }, []);

  const loadLLMLogs = useCallback(async () => {
    const logs = await listLLMLogs();
    setLlmLogs(logs.sort((a, b) => b.timestamp - a.timestamp));
  }, []);

  const loadEmbeddingLogs = useCallback(async () => {
    const logs = await listEmbeddingLogs();
    setEmbeddingLogs(logs.sort((a, b) => b.timestamp - a.timestamp));
  }, []);

  const loadNetworkLogs = useCallback(async () => {
    const logs = await listNetworkLogs();
    setNetworkLogs(logs.sort((a, b) => b.timestamp - a.timestamp));
  }, []);

  const loadDBStats = useCallback(async () => {
    const stats = await getDBStats();
    setDbStats(stats);
  }, []);

  useEffect(() => {
    loadChannels();
    loadBots();
    loadHistory();
    loadLogs();
    loadSyncLogs();
    loadLLMLogs();
    loadEmbeddingLogs();
    loadNetworkLogs();
    loadDBStats();
  }, [loadChannels, loadBots, loadHistory, loadLogs, loadSyncLogs, loadLLMLogs, loadEmbeddingLogs, loadNetworkLogs, loadDBStats]);

  return (
    <DataContext.Provider
      value={{
        channels, setChannels, loadChannels,
        botCredentials, setBotCredentials,
        chatDestinations, setChatDestinations, loadBots,
        channelStats, setChannelStats,
        summariesHistory, setSummariesHistory, loadHistory,
        dbStats, setDbStats, loadDBStats,
        publishLogs, setPublishLogs, loadLogs,
        syncLogs, setSyncLogs, loadSyncLogs,
        llmLogs, setLlmLogs, loadLLMLogs,
        embeddingLogs, setEmbeddingLogs, loadEmbeddingLogs,
        networkLogs, setNetworkLogs, loadNetworkLogs,
        selectedChannels, setSelectedChannels,
        prevChannelNames, setPrevChannelNames
      }}
    >
      {children}
    </DataContext.Provider>
  );
};

export const useData = () => {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error("useData must be used within a DataProvider");
  }
  return context;
};
