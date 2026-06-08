import React, { useState, useEffect } from "react";
import { Post } from "../types";
import { getPost } from "../lib/db";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tg-tooltip";
import { Loader2, ExternalLink } from "lucide-react";

interface CitationHoverProps {
  channelName: string;
  postId: number;
  postSnapshot?: Post;
}

export function CitationHover({ channelName, postId, postSnapshot }: CitationHoverProps) {
  const [post, setPost] = useState<Post | null>(postSnapshot || null);
  const [loading, setLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(!!postSnapshot);

  useEffect(() => {
    if (postSnapshot) {
      setPost(postSnapshot);
      setHasFetched(true);
    }
  }, [postSnapshot]);

  const handleOpenChange = (open: boolean) => {
    if (open && !hasFetched && !loading && !postSnapshot) {
      setLoading(true);
      getPost(channelName, postId)
        .then((p) => {
          setPost(p || null);
          setHasFetched(true);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  };

  const isRTL = (text: string) => {
    const rtlRegex = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;
    return rtlRegex.test(text);
  };

  const textIsRTL = post?.text ? isRTL(post.text) : false;

  return (
    <Tooltip onOpenChange={handleOpenChange} disableHoverablePopup={false}>
      <TooltipTrigger asChild>
        <span 
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className="inline-flex items-center justify-center px-1.5 py-0.5 mx-1 text-[10px] font-mono font-bold uppercase tracking-wider bg-app-ink/10 text-app-ink rounded cursor-help hover:bg-app-ink hover:text-app-bg transition-colors relative z-10"
        >
          {channelName} #{postId}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="center"
        className="max-w-md !p-3 shadow-xl pointer-events-auto"
      >
        <div className="flex flex-col gap-2 w-full min-w-0">
          <div className="flex items-center justify-between pb-2 border-b border-background/20 shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-wider opacity-60">
              Source Post
            </span>
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono opacity-60 truncate max-w-[150px]">
                {channelName} #{postId}
              </span>
              <a 
                href={`https://t.me/s/${channelName}/${postId}`} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 transition-colors shrink-0"
                title="Open in Telegram"
              >
                <ExternalLink size={12} />
              </a>
            </div>
          </div>
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin opacity-50" />
            </div>
          ) : post ? (
            <div 
              className={`text-sm leading-relaxed max-h-64 overflow-y-auto pr-1 whitespace-pre-wrap break-words ${textIsRTL ? 'text-right' : 'text-left'}`}
              dir={textIsRTL ? 'rtl' : 'ltr'}
            >
              {post.text || "No text content available."}
            </div>
          ) : (
            <div className="text-sm italic opacity-60 py-2 text-center">
              Post not found in local database.
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
