import React, { useState } from "react";
import { motion } from "motion/react";
import { Bot, Plus, Loader2, CheckCircle2, XCircle, RefreshCw, Trash2, Send, RotateCcw, MessageSquare, Activity } from "lucide-react";
import { useData } from "../contexts/DataContext";
import { useSettings } from "../contexts/SettingsContext";
import { BotCredential, ChatDestination, PublishLog, NetworkLog } from "../types";
import { saveBotCredential, deleteBotCredential, saveChatDestination, deleteChatDestination, savePublishLog, saveNetworkLog } from "../lib/repository";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tg-tooltip";
import { publishSummary, fetchBotInfo as fetchBotInfoApi } from "../services/telegram";
import { buildActiveProxies } from "@/lib/syncSettings";
import { RelativeTime } from "./RelativeTime";
import { BotAvatar } from "./BotAvatar";

interface BotManagementProps {}

export const BotManagement: React.FC<BotManagementProps> = () => {
  const { loadLogs, botCredentials, setBotCredentials, chatDestinations, setChatDestinations, publishLogs, loadNetworkLogs } = useData();
  const { 
    proxyEnabled, 
    defaultProxyUrls, 
    torEnabled, 
    torMode, 
    torProxyUrls, 
    torAutoRotate, 
    torRotationThreshold, 
  } = useSettings();

  const [selectedQuickBotId, setSelectedQuickBotId] = useState<string>("");
  const [selectedQuickDestId, setSelectedQuickDestId] = useState<string>("");
  const [quickMessage, setQuickMessage] = useState<string>("");

  const [newBotName, setNewBotName] = useState("");
  const [newBotToken, setNewBotToken] = useState("");
  const [newDestName, setNewDestName] = useState("");
  const [newDestChatId, setNewDestChatId] = useState("");
  const [isAutoFetchingBot, setIsAutoFetchingBot] = useState(false);
  const [isAutoFetchingDest, setIsAutoFetchingDest] = useState(false);
  const [botValidation, setBotValidation] = useState<Record<string, { isValid: boolean; botInfo?: string; loading: boolean }>>({});

  const getActiveProxies = () =>
    buildActiveProxies({
      proxyEnabled,
      defaultProxyUrls,
      torEnabled,
      torMode,
      torProxyUrls,
    });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fetchBotInfo = async (
    credentialId: string | undefined,
    token: string | undefined,
    method: string,
    params?: Record<string, string | number>
  ): Promise<any> => {
    const activeProxies = getActiveProxies();
    const startTime = Date.now();
    let status = 0;
    let errorMsg: string | undefined;
    let telemetryData: any;

    try {
      const data: any = await fetchBotInfoApi(
        credentialId,
        token,
        method,
        params,
        activeProxies.length > 0,
        activeProxies,
        torAutoRotate,
        torRotationThreshold,
      );
      status = 200;
      telemetryData = data.telemetry;
      return data;
    } catch (error: any) {
      errorMsg = error.message;
      throw error;
    } finally {
      const duration = Date.now() - startTime;
      const proxyUsed = telemetryData?.attempts?.[telemetryData.attempts.length - 1]?.proxyUrl;
      const attempts = telemetryData?.attempts?.length || 1;

      const logEntry: NetworkLog = {
        id: crypto.randomUUID(),
        url: `https://api.telegram.org/bot.../${method}`,
        method: "POST",
        status: status === 200 ? "success" : "failed",
        statusCode: status,
        duration: telemetryData?.totalDuration || duration,
        source: "BotManagement",
        timestamp: Date.now(),
        error: errorMsg,
        proxyUsed,
        attempts,
        telemetry: telemetryData
      };
      saveNetworkLog(logEntry).then(() => loadNetworkLogs()).catch(e => console.error("Failed to save network log:", e));
    }
  };

  const handleBotTokenChange = async (token: string) => {
    setNewBotToken(token);
    // Basic regex for Telegram bot token: digits:chars
    if (token.includes(":") && token.length > 20) {
      setIsAutoFetchingBot(true);
      try {
        const data = await fetchBotInfo(undefined, token, "getMe");
        if (data.ok && !newBotName) {
          setNewBotName(data.result.first_name || data.result.username || "");
        }
      } catch (e) {
        console.error("Auto-fetch bot failed", e);
      } finally {
        setIsAutoFetchingBot(false);
      }
    }
  };

  const handleDestChatIdChange = async (chatId: string) => {
    setNewDestChatId(chatId);
    if (chatId.length >= 4 && botCredentials.length > 0) {
      const bot = botCredentials[0];
      setIsAutoFetchingDest(true);
      try {
        const data = await fetchBotInfo(bot.id, undefined, "getChat", { chat_id: chatId });
        if (data.ok && !newDestName) {
          setNewDestName(data.result.title || data.result.username || data.result.first_name || "");
        }
      } catch (e) {
        console.error("Auto-fetch dest failed", e);
      } finally {
        setIsAutoFetchingDest(false);
      }
    }
  };

  const handleAddBotCredential = async () => {
    if (!newBotToken) {
      toast.error("Please provide a Bot Token.");
      return;
    }
    const nameToUse = newBotName || "Unnamed Bot";
    const newBot: BotCredential = {
      id: Date.now().toString(),
      name: nameToUse,
      token: newBotToken,
    };
    await saveBotCredential(newBot);
    setBotCredentials(prev => [...prev, { ...newBot, token: undefined, hasToken: true }]);
    setNewBotName("");
    setNewBotToken("");
    handleCheckBotToken(newBot.id);
  };

  const handleCheckBotToken = async (id: string) => {
    setBotValidation(prev => ({ ...prev, [id]: { isValid: false, loading: true } }));
    try {
      const data = await fetchBotInfo(id, undefined, "getMe");
      if (data.ok) {
        let photoPath = "";
        if (data.result.can_join_groups && data.result.can_read_all_group_messages !== undefined) {
          try {
            const photosData = await fetchBotInfo(id, undefined, "getUserProfilePhotos", { user_id: data.result.id, limit: 1 });
            if (photosData.ok && photosData.result.total_count > 0) {
              const fileId = photosData.result.photos[0][0].file_id;
              const fileData = await fetchBotInfo(id, undefined, "getFile", { file_id: fileId });
              if (fileData.ok) {
                photoPath = fileData.result.file_path;
              }
            }
          } catch (e) {
            console.error("Error fetching bot photo:", e);
          }
        }

        const updatedBot = botCredentials.find(b => b.id === id);
        if (updatedBot) {
          const newBot = { 
            ...updatedBot, 
            username: data.result.username, 
            photoUrl: photoPath || updatedBot.photoUrl,
            lastValidated: Date.now(),
            hasToken: true,
          };
          await saveBotCredential(newBot);
          setBotCredentials(prev => prev.map(b => b.id === id ? newBot : b));
        }

        setBotValidation(prev => ({
          ...prev,
          [id]: { 
            isValid: true, 
            botInfo: `@${data.result.username} (${data.result.first_name})`, 
            loading: false 
          }
        }));
      } else {
        setBotValidation(prev => ({
          ...prev,
          [id]: { isValid: false, botInfo: "Invalid Token", loading: false }
        }));
      }
    } catch (err) {
      setBotValidation(prev => ({
        ...prev,
        [id]: { isValid: false, botInfo: "Network Error", loading: false }
      }));
    }
  };

  const [destValidation, setDestValidation] = useState<Record<string, { isValid: boolean; info?: string; loading: boolean }>>({});

  const handleCheckDestination = async (destId: string, chatId: string) => {
    if (botCredentials.length === 0) {
      toast.error("Please add a bot first to validate destinations.");
      return;
    }
    
    const bot = botCredentials[0]; // Use first bot for validation
    setDestValidation(prev => ({ ...prev, [destId]: { isValid: false, loading: true } }));
    
    try {
      const data = await fetchBotInfo(bot.id, undefined, "getChat", { chat_id: chatId });
      
      if (data.ok) {
        let info = data.result.title || data.result.username || data.result.first_name || "Valid Chat";
        if (data.result.type) info += ` (${data.result.type.toUpperCase()})`;
        
        setDestValidation(prev => ({
          ...prev,
          [destId]: { isValid: true, info, loading: false }
        }));
      } else {
        setDestValidation(prev => ({
          ...prev,
          [destId]: { isValid: false, info: data.description || "Invalid Chat ID", loading: false }
        }));
      }
    } catch (err) {
      setDestValidation(prev => ({
        ...prev,
        [destId]: { isValid: false, info: "Network Error", loading: false }
      }));
    }
  };

  const handleDeleteBotCredential = async (id: string) => {
    await deleteBotCredential(id);
    setBotCredentials(prev => prev.filter(b => b.id !== id));
    if (selectedQuickBotId === id) setSelectedQuickBotId("");
  };

  const handleAddChatDestination = async () => {
    if (!newDestChatId) {
      toast.error("Please provide a Chat ID.");
      return;
    }
    const nameToUse = newDestName || "Unnamed Destination";
    const newDest: ChatDestination = {
      id: Date.now().toString(),
      name: nameToUse,
      chatId: newDestChatId,
    };
    await saveChatDestination(newDest);
    setChatDestinations(prev => [...prev, newDest]);
    setNewDestName("");
    setNewDestChatId("");
    // Trigger validation immediately
    handleCheckDestination(newDest.id, newDest.chatId);
  };

  const handleDeleteChatDestination = async (id: string) => {
    await deleteChatDestination(id);
    setChatDestinations(prev => prev.filter(d => d.id !== id));
    if (selectedQuickDestId === id) setSelectedQuickDestId("");
  };

  const handleTestBot = async (botId: string, chatId: string, botName: string, destName: string) => {
    const testMessage = `🔔 Test Connection: Bot "${botName}" is working correctly!`;
    try {
      const activeProxies = getActiveProxies();
      const result = await publishSummary(
        botId, 
        chatId, 
        testMessage,
        undefined,
        activeProxies.length > 0,
        activeProxies,
        torAutoRotate,
        torRotationThreshold,
      );
      
      // Log the result
      const log: PublishLog = {
        id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
        summaryId: "test-" + Date.now(),
        botId: botId,
        botName: botName,
        chatId: chatId,
        chatName: destName,
        status: result.success ? "success" : "failed",
        error: result.error,
        timestamp: Date.now(),
        fullRequest: result.requests,
        fullResponse: result.responses,
        textSent: testMessage
      };
      await savePublishLog(log);
      await loadLogs();

      if (result.success) {
        toast.success(`Test message sent successfully using ${botName}!`);
      } else {
        toast.error("Test failed: " + result.error);
      }
    } catch (e: unknown) {
      toast.error("Test failed: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handlePublish = async (botId: string, chatId: string, botName: string, text: string, destName: string) => {
    try {
      const activeProxies = getActiveProxies();
      const result = await publishSummary(
        botId, 
        chatId, 
        text,
        undefined,
        activeProxies.length > 0,
        activeProxies,
        torAutoRotate,
        torRotationThreshold,
      );
      
      // Log the result
      const log: PublishLog = {
        id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
        summaryId: "quick-" + Date.now(),
        botId: botId,
        botName: botName,
        chatId: chatId,
        chatName: destName,
        status: result.success ? "success" : "failed",
        error: result.error,
        timestamp: Date.now(),
        fullRequest: result.requests,
        fullResponse: result.responses,
        textSent: text
      };
      await savePublishLog(log);
      await loadLogs();

      if (result.success) {
        toast.success(`Successfully published using ${botName}!`);
      } else {
        toast.error("Error publishing: " + result.error);
      }
    } catch (e: unknown) {
      toast.error("Error publishing: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <motion.div
      key="bots"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8 max-w-5xl pb-20"
    >
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex justify-between items-end">
          <div className="text-left">
            <div className="flex items-baseline gap-3">
              <h3 className="text-sm uppercase font-bold tracking-widest">Bot & Destination Management</h3>
              <span className="text-[10px] font-mono opacity-40">[COMMUNICATIONS]</span>
            </div>
            <p className="text-[10px] italic serif opacity-50 mt-1">
              Configure Telegram bots and define publication targets.
            </p>
          </div>
        </div>
        <div className="h-px bg-app-ink/10 w-full" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-8">
          {/* Bot Credentials Section */}
          <div className="bg-app-card border border-app-ink/10 p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-6">
              <Bot size={18} className="opacity-40" />
              <h4 className="text-[11px] uppercase font-bold tracking-widest">Bot Credentials</h4>
            </div>
            
            <p className="text-[10px] opacity-40 italic serif mb-6">
              Add your Telegram Bot tokens here to enable automated publishing and testing.
            </p>

            <div className="space-y-4 mb-8">
              <div className="flex flex-col gap-3">
                <div className="relative">
                  <input
                    type="password"
                    placeholder="BOT TOKEN (FROM @BOTFATHER)"
                    value={newBotToken}
                    onChange={(e) => handleBotTokenChange(e.target.value)}
                    className="w-full bg-app-ink/5 border border-app-ink/10 p-3 text-[10px] font-mono uppercase tracking-widest focus:outline-none focus:border-app-ink/30 transition-all"
                  />
                  {isAutoFetchingBot && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <Loader2 size={12} className="animate-spin opacity-40" />
                    </div>
                  )}
                </div>
                <input
                  type="text"
                  placeholder="BOT NAME (AUTO-FILLED OR CUSTOM)"
                  value={newBotName}
                  onChange={(e) => setNewBotName(e.target.value)}
                  className="w-full bg-app-ink/5 border border-app-ink/10 p-3 text-[10px] font-mono uppercase tracking-widest focus:outline-none focus:border-app-ink/30 transition-all"
                />
              </div>
              <button
                onClick={handleAddBotCredential}
                className="w-full px-4 py-3 bg-app-ink text-app-bg text-[10px] font-bold uppercase tracking-widest hover:opacity-90 transition-all flex items-center justify-center gap-2"
              >
                <Plus size={14} /> Save Bot
              </button>
            </div>

            <div className="space-y-2">
              {botCredentials.length === 0 ? (
                <div className="text-center py-8 opacity-30 italic serif text-[10px] border border-dashed border-app-ink/10">
                  No bot credentials saved yet.
                </div>
              ) : (
                botCredentials.map((bot) => {
                  const botStats = publishLogs.filter(l => l.botId === bot.id && l.status === "success").length;
                  return (
                    <div key={bot.id} className="group flex flex-col p-4 border border-app-ink/10 bg-app-card hover:border-app-ink/30 transition-all gap-4">
                      <div className="flex justify-between items-start">
                        <div className="flex items-start gap-4 min-w-0 flex-1">
                          <div className="relative shrink-0 mt-0.5">
                            <BotAvatar bot={bot} />
                            {botValidation[bot.id]?.isValid && (
                              <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-app-card flex items-center justify-center">
                                <CheckCircle2 size={10} className="text-white" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-[11px] font-bold uppercase tracking-widest truncate">{bot.name}</h3>
                            <div className="flex items-center gap-2 mt-1">
                              {bot.username && (
                                <span className="text-[9px] font-mono text-blue-500">@{bot.username}</span>
                              )}
                              <span className="text-[9px] font-mono opacity-40 truncate">
                                {bot.hasToken ? "Token stored on server" : "No token"}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => handleCheckBotToken(bot.id)}
                                disabled={botValidation[bot.id]?.loading}
                                className="p-2 hover:bg-app-ink/5 rounded-full transition-colors opacity-60 hover:opacity-100 disabled:opacity-20"
                              >
                                {botValidation[bot.id]?.loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-[9px] uppercase font-bold">Validate Token</p>
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => handleDeleteBotCredential(bot.id)}
                                className="p-2 hover:bg-red-500/10 text-red-500 rounded-full transition-colors opacity-60 hover:opacity-100"
                              >
                                <Trash2 size={14} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-[9px] uppercase font-bold">Delete Bot</p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between pt-3 border-t border-app-ink/5">
                        <div className="flex items-center gap-6">
                          <div className="flex flex-col">
                            <span className="text-[8px] font-mono uppercase tracking-widest opacity-40 mb-0.5">Status</span>
                            <span className={`text-[10px] font-mono uppercase tracking-widest ${botValidation[bot.id]?.isValid ? 'text-green-500' : botValidation[bot.id]?.isValid === false ? 'text-red-500' : 'opacity-40'}`}>
                              {botValidation[bot.id]?.loading ? 'Checking...' : botValidation[bot.id]?.isValid ? 'Active' : botValidation[bot.id]?.isValid === false ? 'Invalid' : 'Unknown'}
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[8px] font-mono uppercase tracking-widest opacity-40 mb-0.5">Messages Sent</span>
                            <span className="text-[10px] font-bold font-mono">{botStats}</span>
                          </div>
                          {bot.lastValidated && (
                            <div className="flex flex-col">
                              <span className="text-[8px] font-mono uppercase tracking-widest opacity-40 mb-0.5">Last Validated</span>
                              <span className="text-[10px] font-mono opacity-60"><RelativeTime timestamp={bot.lastValidated} /></span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Quick Message Section */}
          {botCredentials.length > 0 && chatDestinations.length > 0 && (
            <div id="quick-message-section" className="bg-app-card border border-app-ink/10 p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <MessageSquare size={18} className="opacity-40" />
                <h4 className="text-[11px] uppercase font-bold tracking-widest">Quick Message</h4>
              </div>
              
              <p className="text-[10px] opacity-40 italic serif mb-6">
                Send an arbitrary message using a selected bot to a selected destination.
              </p>
              
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3">
                  <select
                    value={selectedQuickBotId}
                    onChange={(e) => setSelectedQuickBotId(e.target.value)}
                    className="w-full bg-app-ink/5 border border-app-ink/10 p-3 text-[10px] font-mono uppercase tracking-widest focus:outline-none focus:border-app-ink/30 transition-all"
                  >
                    <option value="">SELECT BOT</option>
                    {botCredentials.map(b => (
                      <option key={b.id} value={b.id} className="bg-app-card text-app-ink">{b.name.toUpperCase()}</option>
                    ))}
                  </select>
                  <select
                    value={selectedQuickDestId}
                    onChange={(e) => setSelectedQuickDestId(e.target.value)}
                    className="w-full bg-app-ink/5 border border-app-ink/10 p-3 text-[10px] font-mono uppercase tracking-widest focus:outline-none focus:border-app-ink/30 transition-all"
                  >
                    <option value="">SELECT DESTINATION</option>
                    {chatDestinations.map(d => (
                      <option key={d.id} value={d.id} className="bg-app-card text-app-ink">{d.name.toUpperCase()}</option>
                    ))}
                  </select>
                </div>
                <textarea
                  placeholder="TYPE YOUR MESSAGE HERE..."
                  value={quickMessage}
                  onChange={(e) => setQuickMessage(e.target.value)}
                  rows={4}
                  className="w-full bg-app-ink/5 border border-app-ink/10 p-3 text-[10px] font-mono uppercase tracking-widest focus:outline-none focus:border-app-ink/30 transition-all resize-none"
                />
                <button
                  onClick={() => {
                    const bot = botCredentials.find(b => b.id === selectedQuickBotId);
                    const dest = chatDestinations.find(d => d.id === selectedQuickDestId);
                    if (bot && dest && quickMessage) {
                      handlePublish(bot.id, dest.chatId, bot.name, quickMessage, dest.name);
                      setQuickMessage("");
                    } else {
                      toast.error("Please select a bot, a destination, and type a message.");
                    }
                  }}
                  disabled={!selectedQuickBotId || !selectedQuickDestId || !quickMessage}
                  className="w-full px-4 py-3 bg-app-ink text-app-bg text-[10px] font-bold uppercase tracking-widest hover:opacity-90 transition-all flex items-center justify-center gap-2 disabled:opacity-20 disabled:cursor-not-allowed"
                >
                  <Send size={14} /> Send Message
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-8">
          {/* Chat Destinations Section */}
          <div className="bg-app-card border border-app-ink/10 p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-6">
              <Send size={18} className="opacity-40" />
              <h4 className="text-[11px] uppercase font-bold tracking-widest">Chat Destinations</h4>
            </div>

            <p className="text-[10px] opacity-40 italic serif mb-6">
              Manage the channels, groups, or users where you want to publish summaries.
            </p>

            <div className="space-y-4 mb-8">
              <div className="flex flex-col gap-3">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="CHAT ID (E.G., @MYCHANNEL OR -100...)"
                    value={newDestChatId}
                    onChange={(e) => handleDestChatIdChange(e.target.value)}
                    className="w-full bg-app-ink/5 border border-app-ink/10 p-3 text-[10px] font-mono uppercase tracking-widest focus:outline-none focus:border-app-ink/30 transition-all"
                  />
                  {isAutoFetchingDest && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <Loader2 size={12} className="animate-spin opacity-40" />
                    </div>
                  )}
                </div>
                <input
                  type="text"
                  placeholder="DESTINATION NAME (AUTO-FILLED OR CUSTOM)"
                  value={newDestName}
                  onChange={(e) => setNewDestName(e.target.value)}
                  className="w-full bg-app-ink/5 border border-app-ink/10 p-3 text-[10px] font-mono uppercase tracking-widest focus:outline-none focus:border-app-ink/30 transition-all"
                />
              </div>
              <button
                onClick={handleAddChatDestination}
                className="w-full px-4 py-3 bg-app-ink text-app-bg text-[10px] font-bold uppercase tracking-widest hover:opacity-90 transition-all flex items-center justify-center gap-2"
              >
                <Plus size={14} /> Save Destination
              </button>
            </div>

            <div className="space-y-2">
              {chatDestinations.length === 0 ? (
                <div className="text-center py-8 opacity-30 italic serif text-[10px] border border-dashed border-app-ink/10">
                  No destinations saved yet.
                </div>
              ) : (
                chatDestinations.map((dest) => (
                  <div key={dest.id} className="group flex flex-col p-4 border border-app-ink/10 bg-app-card hover:border-app-ink/30 transition-all gap-4">
                    <div className="flex justify-between items-start">
                      <div className="flex items-start gap-4 min-w-0 flex-1">
                        <div className="relative shrink-0 mt-0.5">
                          <div className="w-10 h-10 rounded-full bg-app-ink/5 border border-app-ink/10 flex items-center justify-center">
                            <Send size={16} className="opacity-40" />
                          </div>
                          {destValidation[dest.id]?.isValid && (
                            <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-app-card flex items-center justify-center">
                              <CheckCircle2 size={10} className="text-white" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 pt-0.5">
                          <h3 className="text-[11px] font-bold uppercase tracking-widest truncate">{dest.name}</h3>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[9px] font-mono opacity-40 truncate">
                              {dest.chatId}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => handleCheckDestination(dest.id, dest.chatId)}
                              disabled={destValidation[dest.id]?.loading}
                              className="p-2 hover:bg-app-ink/5 rounded-full transition-colors opacity-60 hover:opacity-100 disabled:opacity-20"
                            >
                              {destValidation[dest.id]?.loading ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-[9px] uppercase font-bold">Verify Destination</p>
                          </TooltipContent>
                        </Tooltip>
                        {botCredentials.length > 0 && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => {
                                  const bot = botCredentials[0]; // Use first bot for quick test
                                  handleTestBot(bot.id, dest.chatId, bot.name, dest.name);
                                }}
                                className="p-2 hover:bg-app-ink/5 rounded-full transition-colors opacity-60 hover:opacity-100"
                              >
                                <RotateCcw size={14} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-[9px] uppercase font-bold">Test Connection</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => handleDeleteChatDestination(dest.id)}
                              className="p-2 hover:bg-red-500/10 text-red-500 rounded-full transition-colors opacity-60 hover:opacity-100"
                            >
                              <Trash2 size={14} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-[9px] uppercase font-bold">Delete Destination</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                    {destValidation[dest.id] && (
                      <div className="flex items-center justify-between pt-3 border-t border-app-ink/5">
                        <div className="flex items-center gap-6">
                          <div className="flex flex-col">
                            <span className="text-[8px] font-mono uppercase tracking-widest opacity-40 mb-0.5">Status</span>
                            <span className={`text-[10px] font-mono uppercase tracking-widest ${destValidation[dest.id]?.isValid ? 'text-green-500' : destValidation[dest.id]?.isValid === false ? 'text-red-500' : 'opacity-40'}`}>
                              {destValidation[dest.id]?.loading ? 'Checking...' : destValidation[dest.id]?.isValid ? 'Valid' : destValidation[dest.id]?.isValid === false ? 'Invalid' : 'Unknown'}
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[8px] font-mono uppercase tracking-widest opacity-40 mb-0.5">Details</span>
                            <span className="text-[10px] font-mono uppercase tracking-widest max-w-[150px] truncate">
                              {destValidation[dest.id].info || (destValidation[dest.id].loading ? 'Verifying...' : 'Invalid')}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
