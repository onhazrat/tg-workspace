import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { Channel, BotCredential, ChatDestination, ChannelStats, Summary, DBStats, PublishLog, SyncLog, LLMLog, EmbeddingLog, NetworkLog } from "../types";
import { 
  getChannels, 
  getBotCredentials, 
  getChatDestinations, 
  getDBStats, 
  getChannelStats, 
  getSummaries,
  getBots,
  deleteBot,
  getPublishLogs,
  getSyncLogs,
  getLLMLogs,
  getEmbeddingLogs,
  getNetworkLogs
} from "../lib/db";

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
    const storedChannels = await getChannels();
    // Ensure all channels have a startId (for backward compatibility), unless they have a startTime
    const normalizedChannels = storedChannels.map(c => ({
      ...c,
      startId: c.startId !== undefined ? c.startId : (c.startTime !== undefined ? undefined : 1)
    }));
    setChannels(normalizedChannels);
    
    const names = normalizedChannels.map(c => c.name);
    
    // Use functional update to avoid dependency on prevChannelNames
    setPrevChannelNames(prevNames => {
      setSelectedChannels(currentSelected => {
        const nextSelected = new Set(currentSelected);
        names.forEach(name => {
          // If it's a new channel we haven't seen before, select it by default
          if (!prevNames.has(name)) {
            nextSelected.add(name);
          }
        });
        // Also remove channels that no longer exist
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
    
    // Load stats for each channel
    const stats: Record<string, ChannelStats> = {};
    for (const channel of normalizedChannels) {
      const s = await getChannelStats(channel.name);
      if (s) stats[channel.name] = s;
    }
    setChannelStats(stats);
  }, []); // Empty dependencies!

  const loadBots = useCallback(async () => {
    const credentials = await getBotCredentials();
    const destinations = await getChatDestinations();
    setBotCredentials(credentials);
    setChatDestinations(destinations);
    
    // Cleanup old bot logic if needed
    const oldBots = await getBots();
    if (oldBots.length > 0) {
      for (const bot of oldBots) {
        await deleteBot(bot.id);
      }
      setBotCredentials(await getBotCredentials());
      setChatDestinations(await getChatDestinations());
    }
  }, []);

  const loadHistory = useCallback(async () => {
    const history = await getSummaries();
    setSummariesHistory(history.sort((a, b) => b.timestamp - a.timestamp));
  }, []);

  const loadLogs = useCallback(async () => {
    const logs = await getPublishLogs();
    setPublishLogs(logs.sort((a, b) => b.timestamp - a.timestamp));
  }, []);

  const loadSyncLogs = useCallback(async () => {
    const logs = await getSyncLogs();
    setSyncLogs(logs.sort((a, b) => b.timestamp - a.timestamp));
  }, []);

  const loadLLMLogs = useCallback(async () => {
    const logs = await getLLMLogs();
    setLlmLogs(logs.sort((a, b) => b.timestamp - a.timestamp));
  }, []);

  const loadEmbeddingLogs = useCallback(async () => {
    const logs = await getEmbeddingLogs();
    setEmbeddingLogs(logs.sort((a, b) => b.timestamp - a.timestamp));
  }, []);

  const loadNetworkLogs = useCallback(async () => {
    const logs = await getNetworkLogs();
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
