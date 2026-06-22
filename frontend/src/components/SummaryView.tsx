import React, { useState } from "react";
import { motion } from "motion/react";
import { Database, Tag, Send, Clock, Copy, Check, Download, MessageSquare, RefreshCw, Loader2, StickyNote, FileText, ClipboardPaste } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useData } from "../contexts/DataContext";
import { useUI } from "../contexts/UIContext";
import { useSettings } from "../contexts/SettingsContext";
import { toast } from "sonner";
import { useAI, generateDefaultMetadataText } from "../contexts/AIContext";
import { useScraper } from "../contexts/ScraperContext";
import { SummaryConfig } from "./SummaryConfig";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tg-tooltip";
import { RelativeTime } from "./RelativeTime";
import { CitationHover } from "./CitationHover";
import { formatDateToLocalISO } from "../lib/utils";
import { formatSummaryModelLabel, isPendingSummary } from "../constants";

import { publishSummary } from "../services/telegram";
import { buildActiveProxies } from "@/lib/syncSettings";
import { savePublishLog, saveSummary } from "../lib/repository";
import { useApiStatus } from "../hooks/useApiStatus";
import { PublishLog } from "../types";
import { PasteSummaryModal } from "./PasteSummaryModal";

const extractText = (children: React.ReactNode): string => {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return children.toString();
  if (Array.isArray(children)) return children.map(extractText).join('');
  if (React.isValidElement(children)) {
    // If it's a list (ul/ol), we don't want to extract its text when clicking a parent node
    if (children.type === 'ul' || children.type === 'ol') {
      return '';
    }
    // If it's a list item, we don't want to extract its text if it contains a nested list
    if (children.type === 'li') {
      const hasNestedList = React.Children.toArray((children.props as any).children).some(
        (child: any) => React.isValidElement(child) && (child.type === 'ul' || child.type === 'ol')
      );
      if (hasNestedList) {
        return '';
      }
    }
    return extractText((children.props as any).children);
  }
  return '';
};

const CustomMarkdownLi = ({ node, children, ...props }: any) => {
  const { setSemanticSearchQuery } = useScraper();
  const { setActiveTab, currentSummaryId } = useUI();
  const { summariesHistory } = useData();
  const { embeddingsEnabled } = useSettings();

  const currentSummary = summariesHistory.find(s => s.id === currentSummaryId);
  const citedPosts = currentSummary?.citedPosts || {};

  // Find if this li contains a nested list
  const hasNestedList = node?.children?.some(
    (child: any) => child.type === 'element' && (child.tagName === 'ul' || child.tagName === 'ol')
  );
  const isLeaf = !hasNestedList;

  if (!isLeaf) {
    // For parent nodes, just render normally without click handlers
    return <li {...props}>{children}</li>;
  }

  // For leaf nodes, extract text carefully to avoid getting parent text
  // We only want to extract text from the leaf node itself
  const textContent = extractText(children);
  
  const replaceCitations = (nodes: React.ReactNode): React.ReactNode => {
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
          parts.push(
            <CitationHover 
              key={`${match.index}-${match[2]}`} 
              channelName={match[1].trim()} 
              postId={parseInt(match[2], 10)} 
              postSnapshot={citedPosts[`${match[1].trim()}-${parseInt(match[2], 10)}`]}
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
          children: replaceCitations(element.props.children)
        } as any);
      }
      return child;
    });
  };

  return (
    <li 
      {...props} 
      className={embeddingsEnabled ? "cursor-pointer hover:bg-blue-500/10 hover:text-blue-600 dark:hover:text-blue-400 transition-colors rounded px-2 py-1 -mx-2" : "rounded px-2 py-1 -mx-2"}
      onClick={(e) => {
        if (!embeddingsEnabled) return;
        e.stopPropagation();
        if (textContent.trim()) {
          // Optionally remove the citation text from the search query for better semantic matching
          const cleanText = textContent.replace(/\[([^\]]+?)\s*#(\d+)\]/g, '').trim();
          setSemanticSearchQuery(cleanText || textContent.trim());
          setActiveTab("posts");
        }
      }}
      title={embeddingsEnabled ? "Click to find related posts" : undefined}
    >
      {replaceCitations(children)}
    </li>
  );
};

const markdownComponents = {
  li: CustomMarkdownLi
};

interface SummaryViewProps {}

export const SummaryView: React.FC<SummaryViewProps> = () => {
  const { summary, handleSummarize, generateBackgroundSummary, regeneratingSummaries, completePendingSummary } = useAI();
  const { isOffline } = useApiStatus();
  const [copied, setCopied] = useState(false);
  const { loadLogs, botCredentials, chatDestinations, selectedChannels, summariesHistory, loadHistory } = useData();
  const { startDate, endDate, currentSummaryId, summarizing, setActiveTab } = useUI();
  const { filteredPosts, setSemanticSearchQuery } = useScraper();

  const currentSummary = summariesHistory.find(s => s.id === currentSummaryId);
  const isPending = currentSummary ? isPendingSummary(currentSummary) : false;
  const isRegenerating = currentSummary ? regeneratingSummaries.has(currentSummary.id) : false;
  const [pasteModalOpen, setPasteModalOpen] = useState(false);

  const handleRerun = async () => {
    if (isOffline) {
      toast.warning("Server offline — summary generation disabled.");
      return;
    }
    if (currentSummary) {
      toast.promise(generateBackgroundSummary(currentSummary, false), {
        loading: "Re-analyzing current time window...",
        success: "Analysis re-run successfully.",
        error: "Failed to re-run analysis."
      });
    } else {
      handleSummarize();
    }
  };
  const displayDate = currentSummary ? new Date(currentSummary.timestamp) : new Date();

  const formatDateTime = (date: Date) => {
    return date.toLocaleString(undefined, { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false
    });
  };
  const { 
    selectedModel, 
    aiLanguage, 
    isRTL,
    proxyEnabled, 
    defaultProxyUrls, 
    torEnabled, 
    torMode, 
    torProxyUrls, 
    torAutoRotate, 
    torRotationThreshold, 
  } = useSettings();

  const [selectedBotId, setSelectedBotId] = useState<string>("");
  const [selectedDestId, setSelectedDestId] = useState<string>("");
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [noteValue, setNoteValue] = useState("");
  const [sendMetadata, setSendMetadata] = useState(true);
  const [metadataText, setMetadataText] = useState("");
  const [isEditingMetadata, setIsEditingMetadata] = useState(false);

  React.useEffect(() => {
    if (currentSummary) {
      setSendMetadata(currentSummary.sendMetadata !== false);
      setMetadataText(currentSummary.metadataText || generateDefaultMetadataText(currentSummary));
    }
  }, [currentSummaryId, currentSummary?.sendMetadata, currentSummary?.metadataText]);

  const handleSaveNote = async () => {
    if (!currentSummary) return;
    const updatedSummary = { ...currentSummary, note: noteValue };
    await saveSummary(updatedSummary);
    await loadHistory();
    setIsEditingNote(false);
    toast.success("Note saved.");
  };

  const handleDeleteNote = async () => {
    if (!currentSummary) return;
    const updatedSummary = { ...currentSummary, note: undefined };
    await saveSummary(updatedSummary);
    await loadHistory();
    setIsEditingNote(false);
    setNoteValue("");
    toast.success("Note deleted.");
  };

  const getActiveProxies = () =>
    buildActiveProxies({
      proxyEnabled,
      defaultProxyUrls,
      torEnabled,
      torMode,
      torProxyUrls,
    });

  const handlePublish = async (botId: string, chatId: string, botName: string, text: string, destName: string) => {
    if (isOffline) {
      toast.warning("Server offline — publish disabled.");
      return;
    }
    try {
      const activeProxies = getActiveProxies();
      const result = await publishSummary(
        botId, 
        chatId, 
        text,
        sendMetadata ? metadataText : undefined,
        activeProxies.length > 0,
        activeProxies,
        torAutoRotate,
        torRotationThreshold,
      );
      
      // Log the result
      const log: PublishLog = {
        id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
        summaryId: currentSummaryId || "manual-" + Date.now(),
        botId: botId,
        botName: botName,
        chatId: chatId,
        chatName: destName,
        status: result.success ? "success" : "failed",
        error: result.error,
        timestamp: Date.now(),
        fullRequest: result.requests,
        fullResponse: result.responses,
        textSent: sendMetadata ? `${metadataText}\n\n${text}` : text
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
      key="summary"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <SummaryConfig />

      <div 
        dir={isRTL ? "rtl" : "ltr"}
        className={`relative border border-app-ink/10 bg-app-card rounded-xl p-8 md:p-12 shadow-sm ${isRTL ? "text-right" : ""} ${aiLanguage === "Persian" ? "font-persian leading-loose" : isRTL ? "font-serif leading-loose" : ""}`}
      >
        {isPending && currentSummary ? (
          <>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 border-b border-app-ink/10 pb-6">
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <h3 className="text-2xl font-bold tracking-tight">Awaiting External Response</h3>
                  <span className="bg-amber-500/15 text-amber-800 dark:text-amber-200 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider">
                    Prompt copied
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="bg-app-muted/50 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider text-app-ink/60 flex items-center gap-1.5">
                    <Clock size={12} /> <RelativeTime timestamp={currentSummary.timestamp} />
                  </span>
                  <span className="bg-app-muted/50 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider text-app-ink/60 flex items-center gap-1.5">
                    <Database size={12} /> {formatSummaryModelLabel(currentSummary.model)}
                  </span>
                  <span className="bg-app-muted/50 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider text-app-ink/60 flex items-center gap-1.5">
                    <Tag size={12} /> {currentSummary.language}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPasteModalOpen(true)}
                className="flex items-center gap-2 px-5 h-11 bg-app-ink text-app-bg rounded-lg hover:opacity-90 transition-all text-xs font-bold tracking-wide shadow-sm"
              >
                <ClipboardPaste size={14} />
                Paste AI Response
              </button>
            </div>

            <p className="text-sm text-app-ink/70 mb-4">
              Use the prompt below in your external AI tool, then paste the response here to complete this history entry.
            </p>

            <div className="rounded-xl border border-app-ink/10 bg-app-muted/10 p-4 md:p-6">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-app-ink/60">Copied Prompt</h4>
                <button
                  type="button"
                  onClick={() => {
                    if (currentSummary.promptText) {
                      void navigator.clipboard.writeText(currentSummary.promptText);
                      toast.success("Prompt copied again.");
                    }
                  }}
                  disabled={!currentSummary.promptText}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-app-ink/10 hover:bg-app-muted/30 text-[10px] font-bold uppercase tracking-wide disabled:opacity-50"
                >
                  <Copy size={12} />
                  Copy again
                </button>
              </div>
              <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed text-app-ink/80 max-h-[480px] overflow-y-auto custom-scrollbar">
                {currentSummary.promptText || "Prompt text unavailable."}
              </pre>
            </div>

            <div className="mt-8 pt-6 border-t border-app-ink/10 flex flex-wrap gap-2">
              <span className="bg-app-muted/30 px-2 py-1 rounded-md text-[9px] font-mono uppercase tracking-widest text-app-ink/50">
                {currentSummary.postCount ?? 0} Posts
              </span>
              <span className="bg-app-muted/30 px-2 py-1 rounded-md text-[9px] font-mono uppercase tracking-widest text-app-ink/50">
                {currentSummary.channels.length} Channels
              </span>
              <span className="bg-app-muted/30 px-2 py-1 rounded-md text-[9px] font-mono uppercase tracking-widest text-app-ink/50">
                Range: {new Date(currentSummary.startDate).toLocaleString()} - {new Date(currentSummary.endDate).toLocaleString()}
              </span>
            </div>
          </>
        ) : summary ? (
          <>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10 border-b border-app-ink/10 pb-6">
              <div>
                <h3 className="text-2xl font-bold tracking-tight mb-3">Analysis Report</h3>
                <div className="flex flex-wrap gap-2">
                  <span className="bg-app-muted/50 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider text-app-ink/60 flex items-center gap-1.5">
                    <Clock size={12} /> <RelativeTime timestamp={displayDate.getTime()} />
                  </span>
                  <span className="bg-app-muted/50 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider text-app-ink/60 flex items-center gap-1.5">
                    <Database size={12} /> {formatSummaryModelLabel(currentSummary?.model)}
                  </span>
                  <span className="bg-app-muted/50 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider text-app-ink/60 flex items-center gap-1.5">
                    <Tag size={12} /> {currentSummary?.language}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 bg-app-muted/20 p-1.5 rounded-xl border border-app-ink/5">
                {botCredentials.length > 0 && chatDestinations.length > 0 && (
                  <div className="flex items-center gap-2 mr-4">
                    <select
                      value={selectedBotId}
                      onChange={(e) => setSelectedBotId(e.target.value)}
                      className="bg-transparent border border-app-ink border-opacity-20 rounded-lg py-1.5 px-2 focus:outline-none focus:border-opacity-100 transition-colors text-[9px] font-mono appearance-none cursor-pointer"
                    >
                      <option value="">Bot</option>
                      {botCredentials.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                    <select
                      value={selectedDestId}
                      onChange={(e) => setSelectedDestId(e.target.value)}
                      className="bg-transparent border border-app-ink border-opacity-20 rounded-lg py-1.5 px-2 focus:outline-none focus:border-opacity-100 transition-colors text-[9px] font-mono appearance-none cursor-pointer"
                    >
                      <option value="">Dest</option>
                      {chatDestinations.map(d => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button 
                          onClick={() => {
                            const bot = botCredentials.find(b => b.id === selectedBotId);
                            const dest = chatDestinations.find(d => d.id === selectedDestId);
                            if (bot && dest && summary) handlePublish(bot.id, dest.chatId, bot.name, summary, dest.name);
                            else toast.error("Please select both Bot and Destination.");
                          }}
                          disabled={!selectedBotId || !selectedDestId}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-app-ink hover:text-app-bg transition-all text-[10px] uppercase font-bold tracking-wider disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Send size={12} />
                          Publish
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Sends the summary to the selected Telegram destination.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                )}
                {currentSummary && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button 
                        onClick={() => {
                          if (isEditingNote) {
                            setIsEditingNote(false);
                          } else {
                            setIsEditingNote(true);
                            setNoteValue(currentSummary.note || "");
                          }
                        }}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-app-ink hover:text-app-bg transition-all text-[10px] uppercase font-bold tracking-wider ${currentSummary.note ? 'text-amber-600 bg-amber-500/10' : ''}`}
                      >
                        <StickyNote size={12} className={isEditingNote ? "fill-current" : ""} />
                        Note
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{isEditingNote ? "Close Note" : currentSummary.note ? "Edit Note" : "Add Note"}</p>
                    </TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button 
                      onClick={handleRerun}
                      disabled={summarizing || isRegenerating}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-app-ink hover:text-app-bg transition-all text-[10px] uppercase font-bold tracking-wider disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {summarizing || isRegenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                      Re-analyze Window
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Re-analyzes the current time window.</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(summary);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-app-ink hover:text-app-bg transition-all text-[10px] uppercase font-bold tracking-wider"
                    >
                      {copied ? <Check size={12} /> : <Copy size={12} />}
                      {copied ? "Copied" : "Copy Text"}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Copies the summary text to your clipboard.</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button 
                      onClick={() => {
                        const blob = new Blob([summary], { type: 'text/markdown' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `analysis-${formatDateToLocalISO(new Date()).split('T')[0]}.md`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-app-ink hover:text-app-bg transition-all text-[10px] uppercase font-bold tracking-wider"
                    >
                      <Download size={12} />
                      Export .MD
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Downloads the summary as a Markdown file.</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
            <div className="prose prose-sm md:prose-base max-w-none prose-headings:tracking-tight prose-headings:font-bold prose-p:leading-relaxed prose-p:text-app-ink/80 prose-li:text-app-ink/80 prose-li:my-1 dark:prose-invert">
              <ReactMarkdown
                components={markdownComponents}
              >
                {summary}
              </ReactMarkdown>
            </div>
            
            {currentSummary && (isEditingNote || currentSummary.note) && (
              <div className="mt-8">
                {isEditingNote ? (
                  <motion.div 
                    initial={{ opacity: 0, y: -10, rotate: -1 }}
                    animate={{ opacity: 1, y: 0, rotate: 0 }}
                    exit={{ opacity: 0, y: -10, rotate: 1 }}
                    className="p-4 bg-gradient-to-br from-[#fef08a] to-[#fde047] rounded-sm shadow-[2px_4px_12px_rgba(0,0,0,0.08)] relative overflow-hidden" 
                    onClick={e => e.stopPropagation()}
                  >
                    {/* Fold effect top right */}
                    <div className="absolute top-0 right-0 w-6 h-6 bg-gradient-to-bl from-transparent via-transparent to-[rgba(0,0,0,0.05)] rounded-bl-lg" />
                    
                    <textarea
                      value={noteValue}
                      onChange={(e) => setNoteValue(e.target.value)}
                      onInput={(e) => {
                        const target = e.target as HTMLTextAreaElement;
                        target.style.height = 'auto';
                        target.style.height = `${target.scrollHeight}px`;
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          handleSaveNote();
                        } else if (e.key === 'Escape') {
                          setIsEditingNote(false);
                        }
                      }}
                      placeholder="Jot down your thoughts... (Cmd+Enter to save)"
                      className="w-full bg-transparent border-none text-[13px] font-medium text-amber-950 placeholder:text-amber-900/40 focus:outline-none resize-none min-h-[80px] leading-relaxed"
                      autoFocus
                    />
                    <div className="flex justify-between items-center mt-3 pt-2 border-t border-amber-500/20">
                      <span className="text-[10px] text-amber-700/60 font-medium">
                        {noteValue.length} chars
                      </span>
                      <div className="flex gap-2 items-center">
                        {currentSummary.note && (
                          <button 
                            onClick={handleDeleteNote}
                            className="text-[10px] font-bold text-red-600/70 hover:text-red-700 transition-colors px-2 py-1.5 rounded hover:bg-red-500/10 mr-1"
                          >
                            Delete
                          </button>
                        )}
                        <button 
                          onClick={() => setIsEditingNote(false)}
                          className="text-[10px] font-bold text-amber-800/60 hover:text-amber-900 transition-colors px-2 py-1.5 rounded hover:bg-amber-500/10"
                        >
                          Cancel
                        </button>
                        <button 
                          onClick={handleSaveNote}
                          className="text-[10px] font-bold bg-amber-900 hover:bg-amber-950 text-amber-50 transition-colors px-3 py-1.5 rounded shadow-sm flex items-center gap-1"
                        >
                          Save Note
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ) : currentSummary.note ? (
                  <motion.div 
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 bg-gradient-to-br from-[#fef08a]/90 to-[#fde047]/90 rounded-sm shadow-sm cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all relative overflow-hidden group"
                    onClick={() => {
                      setIsEditingNote(true);
                      setNoteValue(currentSummary.note || "");
                    }}
                  >
                    {/* Fold effect top right */}
                    <div className="absolute top-0 right-0 w-6 h-6 bg-gradient-to-bl from-transparent via-transparent to-[rgba(0,0,0,0.05)] rounded-bl-lg transition-all group-hover:w-8 group-hover:h-8" />
                    
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-bold uppercase text-[9px] tracking-wider text-amber-800/70 flex items-center gap-1.5">
                        <StickyNote size={12} className="text-amber-700/50" />
                        Note
                      </span>
                      <span className="opacity-0 group-hover:opacity-100 text-[10px] font-medium text-amber-700/60 transition-opacity bg-amber-500/10 px-2 py-0.5 rounded-full">
                        Edit
                      </span>
                    </div>
                    <p className="text-[13px] font-medium text-amber-950 whitespace-pre-wrap leading-relaxed">
                      {currentSummary.note}
                    </p>
                  </motion.div>
                ) : null}
              </div>
            )}
            
            {currentSummary && (
              <div className="mt-8 border-t border-app-ink/10 pt-6">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-app-ink/60">Publish Metadata</h4>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={sendMetadata}
                      onChange={async (e) => {
                        const checked = e.target.checked;
                        setSendMetadata(checked);
                        const updatedSummary = { ...currentSummary, sendMetadata: checked };
                        await saveSummary(updatedSummary);
                        await loadHistory();
                      }}
                      className="w-3 h-3 accent-app-ink"
                    />
                    <span className="text-[10px] uppercase font-bold text-app-ink">Include Metadata</span>
                  </label>
                </div>
                
                {sendMetadata && (
                  <div className="bg-app-muted/5 border border-app-ink/10 rounded-lg p-4">
                    {isEditingMetadata ? (
                      <div className="space-y-3">
                        <textarea
                          value={metadataText}
                          onChange={(e) => setMetadataText(e.target.value)}
                          className="w-full bg-transparent border border-app-ink/20 rounded p-3 text-xs font-mono focus:outline-none focus:border-app-ink/50 min-h-[120px]"
                        />
                        <div className="flex justify-end gap-2">
                          <button 
                            onClick={() => {
                              setMetadataText(currentSummary.metadataText || generateDefaultMetadataText(currentSummary));
                              setIsEditingMetadata(false);
                            }}
                            className="text-[10px] font-bold uppercase px-3 py-1.5 hover:bg-app-ink/5 rounded transition-colors"
                          >
                            Cancel
                          </button>
                          <button 
                            onClick={async () => {
                              const updatedSummary = { ...currentSummary, metadataText };
                              await saveSummary(updatedSummary);
                              await loadHistory();
                              setIsEditingMetadata(false);
                              toast.success("Metadata updated.");
                            }}
                            className="text-[10px] font-bold uppercase px-3 py-1.5 bg-app-ink text-app-bg rounded transition-colors"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div 
                        className="group relative cursor-pointer"
                        onClick={() => setIsEditingMetadata(true)}
                      >
                        <pre className="text-xs font-mono whitespace-pre-wrap opacity-80 group-hover:opacity-100 transition-opacity">
                          {metadataText}
                        </pre>
                        <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity bg-app-bg/80 backdrop-blur-sm px-2 py-1 rounded text-[9px] font-bold uppercase border border-app-ink/10">
                          Click to Edit
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {currentSummary && (
            <div className="mt-12 pt-6 border-t border-app-ink/10 flex flex-col md:flex-row justify-between items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="bg-app-muted/30 px-2 py-1 rounded-md text-[9px] font-mono uppercase tracking-widest text-app-ink/50">
                  {currentSummary.postCount} Posts Analyzed
                </span>
                <span className="bg-app-muted/30 px-2 py-1 rounded-md text-[9px] font-mono uppercase tracking-widest text-app-ink/50">
                  {currentSummary.channels.length} Channels
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-app-muted/30 px-2 py-1 rounded-md text-[9px] font-mono uppercase tracking-widest text-app-ink/50">
                  Range: {new Date(startDate).toLocaleString()} - {new Date(endDate).toLocaleString()}
                </span>
              </div>
            </div>
            )}
          </>
        ) : summarizing ? (
          <div className="h-full flex flex-col py-12 space-y-8 animate-pulse">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 bg-app-muted/20 rounded-xl"></div>
              <div className="space-y-2">
                <div className="h-5 bg-app-muted/20 rounded-md w-48"></div>
                <div className="h-3 bg-app-muted/20 rounded-md w-32"></div>
              </div>
            </div>
            <div className="space-y-4">
              <div className="h-4 bg-app-muted/20 rounded-md w-full"></div>
              <div className="h-4 bg-app-muted/20 rounded-md w-full"></div>
              <div className="h-4 bg-app-muted/20 rounded-md w-5/6"></div>
            </div>
            <div className="space-y-4 pt-4">
              <div className="h-4 bg-app-muted/20 rounded-md w-full"></div>
              <div className="h-4 bg-app-muted/20 rounded-md w-4/5"></div>
            </div>
            <div className="flex justify-center pt-8">
              <div className="flex items-center gap-2 text-app-ink/40">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-xs font-bold uppercase tracking-widest">Generating Analysis...</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center py-32">
            <div className="w-20 h-20 rounded-3xl bg-app-muted/20 flex items-center justify-center mb-6">
              <FileText size={40} className="opacity-20" strokeWidth={1.5} />
            </div>
            <h3 className="text-lg font-bold tracking-tight mb-2">Ready to Summarize</h3>
            <p className="text-xs text-app-ink/50 max-w-[280px] mx-auto leading-relaxed">
              Generate in-app, or use Copy Prompt to run an external AI and paste the response from History.
            </p>
          </div>
        )}
      </div>

      {currentSummary && isPending && (
        <PasteSummaryModal
          isOpen={pasteModalOpen}
          onClose={() => setPasteModalOpen(false)}
          onSave={(text, modelName) => completePendingSummary(currentSummary.id, text, modelName)}
        />
      )}
    </motion.div>
  );
};
