import React, { createContext, useContext, useState, useRef, useEffect } from "react";
import { ChatMessage, Summary, LLMLog } from "../types";
import { saveSummary, saveLLMLog, getPostsByDateRange } from "../lib/repository";
import { useData } from "./DataContext";
import { useUI } from "./UIContext";
import { useSettings } from "./SettingsContext";
import { useScraper } from "./ScraperContext";
import { generateChatStream, chatWithHistoryStream, AIServiceError } from "../services/ai";
import { useRAG } from "./RAGContext";
import { toast } from "sonner";

type ChatMode = "summary" | "history";

interface ChatContextType {
  chatMessages: ChatMessage[];
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  chatInput: string;
  setChatInput: React.Dispatch<React.SetStateAction<string>>;
  isChatting: boolean;
  chatMode: ChatMode;
  setChatMode: React.Dispatch<React.SetStateAction<ChatMode>>;
  chatEndRef: React.RefObject<HTMLDivElement>;
  chatInputRef: React.RefObject<HTMLTextAreaElement>;
  handleSendMessage: () => Promise<void>;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { channels, selectedChannels, summariesHistory, loadHistory, loadLLMLogs } = useData();
  const { startDate, endDate, activeTab, currentSummaryId, setCurrentSummaryId } = useUI();
  const { aiLanguage, selectedModel, aiTemperature } = useSettings();
  const { filteredPosts, scrapeChannelsInParallel, postSearch, semanticSearchQuery, semanticSearchRespectsTimeRange, semanticSearchRespectsChannels, handleFilterPosts } = useScraper();
  const { searchSimilarPosts } = useRAG();

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatting, setIsChatting] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>("summary");

  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (chatInputRef.current) {
      chatInputRef.current.style.height = "auto";
      const scrollHeight = chatInputRef.current.scrollHeight;
      chatInputRef.current.style.height = `${Math.min(scrollHeight, 200)}px`;
      chatInputRef.current.style.overflowY = scrollHeight > 200 ? "auto" : "hidden";
    }
  }, [chatInput]);

  useEffect(() => {
    if (activeTab === "chat") {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages, activeTab]);

  const handleSendMessage = async () => {
    if (!chatInput.trim() || isChatting) return;

    const userMessage = chatInput.trim();
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", text: userMessage }]);
    setIsChatting(true);

    try {
      const startTime = Date.now();
      let fullModelText = "";
      let lastResponse: any = null;
      let promptUsed = "";
      let configUsed: any = null;
      let systemInstructionUsed = "";
      let similarPostsUsed: any[] | undefined = undefined;

      // Add user message and placeholder for AI
      const initialMessages: { role: "user" | "model"; text: string }[] = [
        ...chatMessages, 
        { role: "user", text: userMessage },
        { role: "model", text: "" }
      ];
      setChatMessages(initialMessages);

      if (chatMode === "history") {
        // RAG Logic
        toast.info("Searching history for relevant context...");

        let similarPosts;
        try {
          similarPosts = await searchSimilarPosts(userMessage, 20);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Semantic search failed";
          toast.error(message);
          throw error;
        }
        similarPostsUsed = similarPosts;
        
        if (similarPosts.length === 0) {
          fullModelText = "I couldn't find any relevant information in your history to answer that question. Please ensure your posts have been synced and processed.";
          setChatMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: "model", text: fullModelText };
            return updated;
          });
        } else {
          // 4. Chat with history stream
          const { stream, prompt, config, systemInstruction } = await chatWithHistoryStream(
            similarPosts,
            aiLanguage,
            selectedModel,
            chatMessages,
            userMessage,
            aiTemperature
          );
          
          promptUsed = prompt;
          configUsed = config;
          systemInstructionUsed = systemInstruction;

          for await (const chunk of stream) {
            const chunkText = chunk.text || "";
            fullModelText += chunkText;
            lastResponse = chunk;
            
            setChatMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = { 
                role: "model", 
                text: fullModelText,
                sources: similarPosts
              };
              return updated;
            });
          }
        }
      } else {
        // Standard Summary Chat Logic
        const now = Date.now();
        const targetTs = Math.min(endDate, now);
        
        const channelsToSync = channels.filter(c => 
          selectedChannels.has(c.name) && 
          (!c.lastUpdated || c.lastUpdated < targetTs - 60000) // 1 minute buffer
        );

        let postsToChat = filteredPosts;

        if (channelsToSync.length > 0) {
          toast.info(`Syncing ${channelsToSync.length} channels to ensure up-to-date data...`);
          await scrapeChannelsInParallel(channelsToSync, "Pre-Chat Sync");
          
          // Fetch updated posts
          const selectedNames = Array.from(selectedChannels);
          let posts = await getPostsByDateRange(selectedNames, startDate, endDate);
          
          if (postSearch.trim()) {
            const query = postSearch.toLowerCase();
            posts = posts.filter(post => 
              post.text.toLowerCase().includes(query) || 
              post.channelName.toLowerCase().includes(query)
            );
          }
          
          postsToChat = posts.sort((a, b) => b.timestamp - a.timestamp);
          
          // Also update the UI state
          handleFilterPosts();
        }

        const postsText = postsToChat
          .map((p) => `[${p.channelName}] ID: ${p.id}\nDate: ${p.date}\nContent: ${p.text}`)
          .join("\n\n---\n\n");

        const { stream, prompt, config, systemInstruction } = await generateChatStream(
          channels.map(c => c.name),
          postsText,
          aiLanguage,
          selectedModel,
          chatMessages,
          userMessage,
          aiTemperature
        );
        
        promptUsed = prompt;
        configUsed = config;
        systemInstructionUsed = systemInstruction;

        for await (const chunk of stream) {
          const chunkText = chunk.text || "";
          fullModelText += chunkText;
          lastResponse = chunk;
          
          setChatMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: "model", text: fullModelText };
            return updated;
          });
        }
      }

      const duration = Date.now() - startTime;

      // Log LLM Interaction
      if (promptUsed) {
        const llmLog: LLMLog = {
          id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
          model: selectedModel,
          prompt: userMessage, // For chat, the prompt is the user message
          response: fullModelText,
          systemInstruction: systemInstructionUsed,
          modelConfig: configUsed,
          fullRequest: { message: userMessage, history: chatMessages, config: configUsed },
          fullResponse: lastResponse,
          tokens: lastResponse?.usageMetadata?.totalTokenCount,
          status: fullModelText ? "success" : "failed",
          timestamp: Date.now(),
          duration: duration,
          type: chatMode === "history" ? "rag_chat" : "chat"
        };
        await saveLLMLog(llmLog);
        await loadLLMLogs();
      }

      const finalMessages: { role: "user" | "model"; text: string; sources?: any[] }[] = [
        ...chatMessages, 
        { role: "user", text: userMessage }, 
        { role: "model", text: fullModelText, sources: similarPostsUsed }
      ];

      // Save to database
      if (currentSummaryId) {
        const existing = summariesHistory.find(s => s.id === currentSummaryId);
        if (existing) {
          const updated: Summary = { ...existing, chatMessages: finalMessages };
          await saveSummary(updated);
          await loadHistory();
        }
      } else {
        // Create a chat-only entry if no summary exists
        const firstMsg = userMessage.length > 50 ? userMessage.substring(0, 50) + "..." : userMessage;
        const newSummary: Summary = {
          id: Date.now().toString(),
          text: `Chat: ${firstMsg}`,
          channels: Array.from(selectedChannels),
          startDate,
          endDate,
          language: aiLanguage,
          model: selectedModel,
          postCount: filteredPosts.length,
          timestamp: Date.now(),
          chatMessages: finalMessages,
          postSearch: postSearch || undefined,
          semanticSearchQuery: semanticSearchQuery || undefined,
          semanticSearchRespectsTimeRange,
          semanticSearchRespectsChannels
        };
        await saveSummary(newSummary);
        setCurrentSummaryId(newSummary.id);
        await loadHistory();
      }
    } catch (err: unknown) {
      console.error(err);
      const errorMessage = err instanceof AIServiceError ? err.message : (err instanceof Error ? err.message : "Failed to generate response");
      setChatMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: "model", text: `Error: ${errorMessage}` };
        return updated;
      });
    } finally {
      setIsChatting(false);
    }
  };

  return (
    <ChatContext.Provider value={{
      chatMessages,
      setChatMessages,
      chatInput,
      setChatInput,
      isChatting,
      chatMode,
      setChatMode,
      chatEndRef,
      chatInputRef,
      handleSendMessage
    }}>
      {children}
    </ChatContext.Provider>
  );
};

export function useChatContext() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error("useChatContext must be used within a ChatProvider");
  }
  return context;
}
