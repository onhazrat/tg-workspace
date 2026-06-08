import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { MessageSquare, Loader2, Copy, Check, Plus, Send, Database, FileText, Sparkles, User, ChevronDown, ChevronUp, Zap } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { ChatMessage } from "../types";
import { LANGUAGES, MODELS } from "../constants";
import { useSettings } from "../contexts/SettingsContext";
import { useScraper } from "../contexts/ScraperContext";
import { useUI } from "../contexts/UIContext";
import { useRAG } from "../contexts/RAGContext";
import { useChatContext } from "../contexts/ChatContext";
import { useData } from "../contexts/DataContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { CitationHover } from "./CitationHover";

const replaceCitations = (nodes: React.ReactNode, sources: any[] | undefined): React.ReactNode => {
  return React.Children.map(nodes, child => {
    if (typeof child === 'string') {
      const parts = [];
      let lastIndex = 0;
      const regex = /\[([^\]]+?)\s*#(\d+)\]/g;
      let match;
      while ((match = regex.exec(child)) !== null) {
        if (match.index > lastIndex) {
          parts.push(child.substring(lastIndex, match.index));
        }
        const channelName = match[1].trim();
        const postId = parseInt(match[2], 10);
        const postSnapshot = sources?.find(s => s.channelName === channelName && s.id === postId);
        
        parts.push(
          <CitationHover 
            key={`${match.index}-${match[2]}`} 
            channelName={channelName} 
            postId={postId} 
            postSnapshot={postSnapshot}
          />
        );
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < child.length) {
        parts.push(child.substring(lastIndex));
      }
      return parts.length > 0 ? parts : child;
    }
    if (React.isValidElement(child)) {
      const element = child as React.ReactElement<any>;
      return React.cloneElement(element, {
        ...element.props,
        children: replaceCitations(element.props.children, sources)
      } as any);
    }
    return child;
  });
};

const SUGGESTED_PROMPTS_SUMMARY = [
  "Summarize the latest trends in these channels",
  "What are the most active discussions about?",
  "Identify any key announcements or news",
];

const SUGGESTED_PROMPTS_HISTORY = [
  "What did we discuss about AI models previously?",
  "Find mentions of specific project deadlines",
  "Summarize past conversations about API limits",
];

export const ChatView: React.FC = () => {
  const [copied, setCopied] = useState(false);
  const [expandedSources, setExpandedSources] = useState<Record<number, boolean>>({});
  
  const { 
    aiLanguage, 
    setAiLanguage, 
    selectedModel, 
    setSelectedModel, 
    isRTL, 
    theme,
    embeddingsEnabled
  } = useSettings();
  const { filteredPosts } = useScraper();
  const { currentSummaryId, setCurrentSummaryId } = useUI();
  const { isSyncing, progress } = useRAG();
  const {
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
  } = useChatContext();

  const toggleSources = (index: number) => {
    setExpandedSources(prev => ({ ...prev, [index]: !prev[index] }));
  };

  const handleSuggestedPrompt = (prompt: string) => {
    setChatInput(prompt);
    setTimeout(() => {
      if (chatInputRef.current) {
        chatInputRef.current.focus();
      }
    }, 50);
  };

  return (
    <motion.div
      key="chat"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full"
    >
      {/* Header Toolbar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 bg-app-card border border-app-ink/10 p-3 rounded-xl shadow-sm shrink-0">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center bg-app-muted rounded-lg p-1 border border-app-ink/10">
            <button
              onClick={() => setChatMode("summary")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-tight transition-all ${
                chatMode === "summary" 
                  ? "bg-app-card text-app-ink shadow-sm" 
                  : "text-app-ink opacity-60 hover:opacity-100 hover:bg-app-ink/5"
              }`}
            >
              <FileText size={12} />
              Current View
            </button>
            {embeddingsEnabled && (
              <button
                onClick={() => setChatMode("history")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-tight transition-all ${
                  chatMode === "history" 
                    ? "bg-app-card text-app-ink shadow-sm" 
                    : "text-app-ink opacity-60 hover:opacity-100 hover:bg-app-ink/5"
                }`}
              >
                <Database size={12} />
                All History
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 border-l border-app-ink/10 pl-4">
            <div className="flex items-center gap-2">
              <span className="text-[9px] uppercase font-bold opacity-40">Lang:</span>
              <select
                value={aiLanguage}
                onChange={(e) => setAiLanguage(e.target.value)}
                className="bg-transparent border-none py-0 focus:outline-none text-[10px] font-bold uppercase tracking-tight cursor-pointer hover:opacity-100 opacity-80 transition-opacity"
              >
                {LANGUAGES.map(l => (
                  <option key={l} value={l} className="bg-app-card text-app-ink">{l}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 border-l border-app-ink/10 pl-3">
              <span className="text-[9px] uppercase font-bold opacity-40">Model:</span>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="bg-transparent border-none py-0 focus:outline-none text-[10px] font-bold uppercase tracking-tight cursor-pointer hover:opacity-100 opacity-80 transition-opacity max-w-[120px] truncate"
              >
                {MODELS.map(m => (
                  <option key={m.id} value={m.id} className="bg-app-card text-app-ink">{m.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {embeddingsEnabled && (
            isSyncing ? (
              <div className="flex items-center gap-2 text-[9px] uppercase font-bold text-blue-500 bg-blue-500/10 px-2 py-1 rounded-md">
                <Loader2 size={12} className="animate-spin" />
                {progress.total > 0 
                  ? `Syncing (${progress.current}/${progress.total})`
                  : 'Checking...'}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[9px] uppercase font-bold text-green-500 bg-green-500/10 px-2 py-1 rounded-md">
                <Check size={12} />
                Embeddings Ready
              </div>
            )
          )}
          {chatMessages.length > 0 && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => {
                      const fullHistory = chatMessages
                        .map(m => `**${m.role === "user" ? "User" : "AI Analyst"}**:\n${m.text}`)
                        .join("\n\n---\n\n");
                      navigator.clipboard.writeText(fullHistory);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="p-1.5 text-app-ink/40 hover:text-app-ink hover:bg-app-ink/5 rounded-md transition-all"
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </TooltipTrigger>
                <TooltipContent><p>Copy Chat History</p></TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => {
                      setChatMessages([]);
                      setCurrentSummaryId(null);
                      setExpandedSources({});
                    }}
                    className="p-1.5 text-app-ink/40 hover:text-red-500 hover:bg-red-500/10 rounded-md transition-all"
                  >
                    <Plus size={14} className="rotate-45" />
                  </button>
                </TooltipTrigger>
                <TooltipContent><p>Clear Conversation</p></TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      {/* Chat Feed */}
      <div className="flex-1 overflow-y-auto space-y-6 mb-4 pr-2 custom-scrollbar">
        {chatMessages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center py-10 max-w-md mx-auto">
            <div className="w-16 h-16 bg-app-card shadow-sm rounded-2xl flex items-center justify-center mb-6 border border-app-ink/10">
              {chatMode === "summary" ? <FileText size={28} className="opacity-40" /> : <Database size={28} className="opacity-40" />}
            </div>
            <h3 className="text-lg font-bold tracking-tight mb-2">
              {chatMode === "summary" ? "Chat with Current View" : "Chat with All History"}
            </h3>
            <p className="text-[11px] opacity-60 mb-8 leading-relaxed max-w-sm">
              {chatMode === "summary" 
                ? "Ask questions about the currently filtered posts. The AI will analyze the visible content to provide answers." 
                : "Ask questions across your entire saved database using semantic search. The AI will find relevant past discussions."}
            </p>
            
            <div className="w-full space-y-2">
              <p className="text-[9px] font-bold uppercase tracking-widest opacity-40 mb-3 text-left pl-1">Suggested Prompts</p>
              {(chatMode === "summary" ? SUGGESTED_PROMPTS_SUMMARY : SUGGESTED_PROMPTS_HISTORY).map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSuggestedPrompt(prompt)}
                  className="w-full text-left p-3 text-[11px] bg-app-card hover:bg-app-muted border border-app-ink/10 rounded-xl transition-all flex items-center gap-3 group shadow-sm hover:shadow-md"
                >
                  <Zap size={14} className="opacity-40 group-hover:opacity-100 group-hover:text-blue-500 transition-colors shrink-0" />
                  <span className="opacity-80 group-hover:opacity-100 font-medium">{prompt}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {chatMessages.map((m, i) => (
          <div
            key={i}
            className={`flex gap-4 ${m.role === "user" ? "flex-row-reverse" : "flex-row"} group/message`}
          >
            {/* Avatar */}
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${
              m.role === "user" 
                ? "bg-app-ink text-app-bg" 
                : "bg-blue-500/10 text-blue-600 border border-blue-500/20"
            }`}>
              {m.role === "user" ? <User size={14} /> : <Sparkles size={14} />}
            </div>

            {/* Bubble Container */}
            <div className={`relative max-w-[85%] sm:max-w-[75%] flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
              
              {/* Message Bubble */}
              <div className={`p-4 text-[13px] leading-relaxed relative group/bubble ${
                m.role === "user"
                  ? "bg-app-ink text-app-bg rounded-2xl rounded-tr-sm shadow-md"
                  : "bg-app-card border border-app-ink/10 rounded-2xl rounded-tl-sm shadow-sm"
              }`}>
                <button
                  onClick={() => navigator.clipboard.writeText(m.text)}
                  className={`absolute -top-3 ${m.role === "user" ? "-left-3 bg-app-card text-app-ink border border-app-ink/10" : "-right-3 bg-app-ink text-app-bg"} opacity-0 group-hover/bubble:opacity-100 transition-opacity p-1.5 rounded-md shadow-sm`}
                  title="Copy message"
                >
                  <Copy size={12} />
                </button>
                
                <div 
                  dir={isRTL ? "rtl" : "ltr"}
                  className={`prose prose-sm max-w-none ${
                    m.role === "user" 
                      ? (theme === "light" ? "prose-invert" : "") 
                      : "dark:prose-invert"
                  } ${isRTL ? "text-right" : ""} ${aiLanguage === "Persian" ? "font-persian leading-loose" : isRTL ? "font-serif leading-loose" : ""}`}
                >
                  <ReactMarkdown
                    components={{
                      p: ({ node, children, ...props }) => <p {...props}>{replaceCitations(children, m.sources)}</p>,
                      li: ({ node, children, ...props }) => <li {...props}>{replaceCitations(children, m.sources)}</li>,
                    }}
                  >
                    {m.text}
                  </ReactMarkdown>
                </div>
              </div>

              {/* Sources (Bento style) */}
              {m.sources && m.sources.length > 0 && (
                <div className="mt-3 w-full flex flex-col items-start">
                  <button 
                    onClick={() => toggleSources(i)} 
                    className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest opacity-50 hover:opacity-100 transition-opacity mb-2 bg-app-muted px-2 py-1 rounded-md"
                  >
                    {expandedSources[i] ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    {m.sources.length} Sources Analyzed
                  </button>
                  
                  <AnimatePresence>
                    {expandedSources[i] && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }} 
                        animate={{ height: 'auto', opacity: 1 }} 
                        exit={{ height: 0, opacity: 0 }} 
                        className="overflow-hidden w-full"
                      >
                        <div className="flex gap-3 overflow-x-auto pb-3 pt-1 custom-scrollbar w-full snap-x">
                          {m.sources.map((source, idx) => (
                            <div key={idx} className="shrink-0 w-64 bg-app-card border border-app-ink/10 p-3 rounded-xl shadow-sm snap-start flex flex-col gap-2">
                              <div className="flex justify-between items-center text-[10px] opacity-60">
                                <span className="font-bold truncate">@{source.channelName}</span>
                                <span className="font-mono shrink-0">{new Date(source.timestamp).toLocaleDateString()}</span>
                              </div>
                              <p className="text-[11px] line-clamp-3 opacity-80 leading-relaxed">{source.text}</p>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </div>
        ))}
        
        {isChatting && (
          <div className="flex gap-4 flex-row group/message">
            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm bg-blue-500/10 text-blue-600 border border-blue-500/20">
              <Sparkles size={14} />
            </div>
            <div className="bg-app-card border border-app-ink/10 rounded-2xl rounded-tl-sm shadow-sm p-4 flex items-center gap-3">
              <Loader2 size={14} className="animate-spin opacity-50" />
              <span className="text-[11px] font-mono uppercase tracking-widest opacity-50">Analyzing...</span>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input Composer */}
      <div className="pt-2 shrink-0">
        <div className="bg-app-card border border-app-ink/10 rounded-2xl shadow-sm p-1.5 flex items-end gap-2 focus-within:border-app-ink/30 focus-within:ring-4 focus-within:ring-app-ink/5 transition-all">
          <textarea
            ref={chatInputRef}
            rows={1}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder="Ask about trends, specific topics, or summarize selected channels..."
            className="flex-1 bg-transparent border-none p-3 text-[13px] focus:outline-none resize-none min-h-[44px] max-h-[200px] custom-scrollbar"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleSendMessage}
                disabled={isChatting || !chatInput.trim()}
                className="bg-app-ink text-app-bg p-3 rounded-xl hover:opacity-90 transition-all disabled:opacity-20 disabled:cursor-not-allowed shrink-0 mb-0.5 mr-0.5 shadow-sm"
              >
                {isChatting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Send Message</p>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex justify-between items-center mt-2 px-2">
          <span className="text-[9px] opacity-40 font-mono uppercase tracking-widest">Enter to send, Shift+Enter for new line</span>
          <span className="text-[9px] opacity-40 font-mono uppercase tracking-widest">AI can make mistakes. Verify info.</span>
        </div>
      </div>
    </motion.div>
  );
};
